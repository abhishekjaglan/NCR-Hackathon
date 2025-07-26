import { AzureOpenAI } from 'openai';
import { apiKey, endpoint, modelName, apiVersion, SYSTEM_PROMPT } from '../utils/config';
import { Request, Response } from 'express';
import { MCPClient, mcpClient } from '../server/server';
import { redisClient } from '../utils/redisClient';

// Remove the in-memory sessionContexts
// const sessionContexts = new Map<string, any[]>();

export class ChatService {
    private API_KEY: string;
    private ENDPOINT: string;
    private MODEL_NAME: string;
    private openai: AzureOpenAI;
    private FIXED_SESSION_ID: string = "fixed-session-dev-001";
    private System_Prompt: string = SYSTEM_PROMPT;
    private mcpClient: MCPClient = mcpClient;

    constructor(API_KEY: string = apiKey, ENDPOINT: string = endpoint, MODEL_NAME: string = modelName) {
        this.API_KEY = API_KEY;
        this.ENDPOINT = ENDPOINT;
        this.MODEL_NAME = MODEL_NAME;
        this.openai = new AzureOpenAI({ 
            endpoint: this.ENDPOINT, 
            apiKey: this.API_KEY, 
            deployment: this.MODEL_NAME, 
            apiVersion 
        });
    }

    // Remove the old getOrInitializeContext method since we'll load from Redis

    /**
     * CORE FUNCTION: Enhanced chat method with Redis chat history and LLM chunking support
     */
    async chat(req: Request, res: Response) {
        const { message: userMessage, sessionId: clientSessionId } = req.body;
        console.log(`[ChatService] Received message: ${userMessage} from session: ${clientSessionId}`);
        const currentSessionId = this.FIXED_SESSION_ID;

        if (!userMessage) {
            return res.status(400).json({ error: 'User message content is required' });
        }

        let internalConversationMessages: any[] = [];
        let displayableConversation: any[] = [];

        try {
            // STEP 1: Ensure Redis connection
            if (!redisClient.isOpen) {
                console.error('Redis client is not connected. Attempting to connect...');
                try {
                    await redisClient.connect();
                    console.log('Reconnected to Redis successfully.');
                } catch (connectErr) {
                    console.error('Failed to reconnect to Redis:', connectErr);
                    return res.status(503).json({ error: 'Chat history service is temporarily unavailable.' });
                }
            }

            // STEP 2: Load displayable history from Redis
            const storedHistory = await redisClient.get(`session:${currentSessionId}:display`);
            if (storedHistory) {
                displayableConversation = JSON.parse(storedHistory);
            }

            const limitedHistory = displayableConversation.slice(-5);

            // STEP 3: Reconstruct internal OpenAI messages from displayable history
            internalConversationMessages = limitedHistory.map(msg => ({
                role: msg.role,
                content: msg.content
            }));

            // STEP 4: Add system prompt if needed
            if (internalConversationMessages.length === 0 || internalConversationMessages[0]?.role !== 'system') {
                internalConversationMessages.unshift({ 
                    role: 'system', 
                    content: this.System_Prompt
                });
            }

            internalConversationMessages.push({ role: 'user', content: userMessage });

            let finalAssistantResponseText: string | null = null;
            let maxIterations = 5; // Increased for complex operations
            let iterations = 0;
            
            // STEP 5: Iterative processing loop
            while (finalAssistantResponseText === null && iterations < maxIterations) {
                iterations++;
                console.log(`[ChatService] Processing iteration ${iterations}/${maxIterations}`);

                // STEP 6: Call Azure OpenAI
                const openaiResponse = await this.openai.chat.completions.create({
                    model: this.MODEL_NAME,
                    messages: internalConversationMessages,
                    tools: this.mcpClient.functionDefinitions.length > 0 ? this.mcpClient.functionDefinitions.map(tool => ({
                        type: "function" as const,
                        function: tool.function
                    })) : undefined,
                    tool_choice: this.mcpClient.functionDefinitions.length > 0 ? 'auto' : undefined,
                    temperature: 0.1 // Low temperature for consistent analysis
                });

                const choice = openaiResponse.choices[0];
                
                // STEP 7: Handle content response
                if (choice.message.content) {
                    internalConversationMessages.push({ 
                        role: 'assistant', 
                        content: choice.message.content 
                    });
                }

                // STEP 8: Handle tool calls (including chunked analysis)
                if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls) {
                    internalConversationMessages.push(choice.message);
                    const toolCalls = choice.message.tool_calls;
                    
                    for (const toolCall of toolCalls) {
                        const { name, arguments: argsString } = toolCall.function;
                        console.log(`[ChatService] Tool call detected: ${name}`);
                        
                        try {
                            const parsedArgs = JSON.parse(argsString);
                            let toolResult;
                            
                            // STEP 9: Check if this is a repository analysis request
                            if (this.isRepositoryAnalysisRequest(name, parsedArgs)) {
                                console.log(`[ChatService] Initiating LLM-powered chunked analysis`);
                                // Extract repository name from URL if needed
                                const actualRepoName = this.extractRepositoryName(parsedArgs.repositoryName);
                                toolResult = await this.handleLLMRepositoryAnalysis(actualRepoName);
                            } else {
                                // Handle regular tool calls
                                console.log(`[ChatService] Calling regular MCP tool: ${name}`);
                                const mcpResponse = await this.mcpClient.client.callTool({
                                    name: name,
                                    arguments: parsedArgs,
                                });
                                toolResult = JSON.parse((mcpResponse.content as any[])[0].text);
                            }
                            
                            // STEP 10: Add tool result to conversation
                            internalConversationMessages.push({
                                role: 'tool',
                                tool_call_id: toolCall.id,
                                content: JSON.stringify(toolResult),
                            });
                            
                        } catch (toolError) {
                            console.error(`[ChatService] Error in tool execution:`, toolError);
                            internalConversationMessages.push({
                                role: 'tool',
                                tool_call_id: toolCall.id,
                                content: JSON.stringify({ 
                                    error: toolError instanceof Error ? toolError.message : 'Unknown error',
                                    details: toolError 
                                }),
                            });
                        }
                    }
                } else {
                    // STEP 11: Final response received
                    finalAssistantResponseText = choice.message.content;
                }
            }
            
            // STEP 12: Handle max iterations reached
            if (!finalAssistantResponseText && iterations >= maxIterations) {
                finalAssistantResponseText = "I seem to be having trouble completing your request after several attempts. Could you please try rephrasing or breaking it down?";
                if (internalConversationMessages[internalConversationMessages.length - 1]?.role !== 'assistant') {
                    internalConversationMessages.push({
                        role: 'assistant', 
                        content: finalAssistantResponseText
                    });
                }
            }

            // STEP 13: Update displayable conversation
            displayableConversation.push({ 
                id: `user-${Date.now()}`, 
                role: 'user', 
                content: userMessage, 
                timestamp: new Date().toISOString(),
                sessionId: currentSessionId 
            });

            if (finalAssistantResponseText) {
                displayableConversation.push({ 
                    id: `assistant-${Date.now()}`, 
                    role: 'assistant', 
                    content: finalAssistantResponseText, 
                    timestamp: new Date().toISOString(),
                    sessionId: currentSessionId
                });
            }

            // STEP 14: Save updated displayable history to Redis
            const redisKey = `session:${currentSessionId}:display`;
            const redisValue = JSON.stringify(displayableConversation);

            if (typeof redisKey !== 'string' || redisKey === '' || typeof redisValue !== 'string') {
                console.error('Invalid key or value for Redis set command.', { redisKey, typeOfValue: typeof redisValue });
            } else {
                await redisClient.set(redisKey, redisValue, {
                    EX: 1800 // Expires in 30 minutes (30 * 60 seconds)
                });
                console.log(`Successfully saved chat history to Redis for session: ${currentSessionId}`);
            }

            return res.json({ 
                assistantResponse: finalAssistantResponseText,
                updatedConversation: displayableConversation 
            });

        } catch (error) {
            console.error('[ChatService] Error in chat processing:', error);
            let detailMessage = "An unexpected error occurred.";
            if (error instanceof Error) {
                detailMessage = error.message;
            } else if (typeof error === 'string') {
                detailMessage = error;
            }
            res.status(500).json({ 
                error: 'Internal server error', 
                details: detailMessage
            });
        }
    }

    /**
     * Get chat history from Redis
     */
    async getChatHistory(req: Request, res: Response) {
        const { sessionId } = req.params;
        // For now, we enforce the fixed session ID regardless of the param for simplicity with current fixed ID logic
        const currentSessionId = this.FIXED_SESSION_ID; 

        if (!currentSessionId) { // This check is more for future when sessionId param is used
            return res.status(400).json({ error: 'Session ID is required.' });
        }

        try {
            // Ensure Redis connection
            if (!redisClient.isOpen) {
                console.error('Redis client is not connected. Attempting to connect...');
                try {
                    await redisClient.connect();
                    console.log('Reconnected to Redis successfully.');
                } catch (connectErr) {
                    console.error('Failed to reconnect to Redis:', connectErr);
                    return res.status(503).json({ error: 'Chat history service is temporarily unavailable.' });
                }
            }

            const storedHistory = await redisClient.get(`session:${currentSessionId}:display`);
            if (storedHistory) {
                res.json(JSON.parse(storedHistory));
            } else {
                res.json([]); // Return empty array if no history found
            }
        } catch (error) {
            console.error('Error fetching history from Redis:', error);
            res.status(500).json({ error: 'Failed to fetch chat history.' });
        }
    }

    // ... keep all other existing methods unchanged (isRepositoryAnalysisRequest, extractRepositoryName, etc.)
    /**
     * HELPER: Detect if this is a repository analysis request
     */
    private isRepositoryAnalysisRequest(toolName: string, args: any): boolean {
        const repositoryAnalysisTools = [
            'analyze_repository_code'
        ];
        
        return repositoryAnalysisTools.includes(toolName) && args.repositoryName;
    }

    /**
     * HELPER: Extract repository name from GitHub URL or return as-is if already a repo name
     */
    private extractRepositoryName(input: string): string {
        // Remove any trailing slashes
        const cleanInput = input.trim().replace(/\/$/, '');
        
        // Check if it's a GitHub URL
        const githubUrlPattern = /(?:https?:\/\/)?(?:www\.)?github\.com\/[^\/]+\/([^\/\?#]+)/i;
        const match = cleanInput.match(githubUrlPattern);
        
        if (match && match[1]) {
            // Extract ONLY the repository name from URL (not org/repo)
            const repoName = match[1];
            console.log(`[ChatService] Extracted repository name '${repoName}' from URL: ${input}`);
            return repoName;
        }
        
        // If it contains a slash, assume it's org/repo format and extract just the repo name
        if (cleanInput.includes('/')) {
            const parts = cleanInput.split('/');
            const repoName = parts[parts.length - 1]; // Get the last part (repo name)
            console.log(`[ChatService] Extracted repository name '${repoName}' from org/repo format: ${cleanInput}`);
            return repoName;
        }
        
        // If it's not a URL and has no slash, assume it's already a repository name
        console.log(`[ChatService] Using input as repository name: ${cleanInput}`);
        return cleanInput;
    }

    /**
     * CORE LLM CHUNKING FUNCTION: Handle repository analysis with LLM-powered chunks
     */
    private async handleLLMRepositoryAnalysis(repositoryName: string): Promise<any> {
        try {
            console.log(`[ChatService] Starting LLM-powered analysis for: ${repositoryName}`);
            
            // PHASE 1: Get repository chunks from server
            console.log(`[ChatService] Phase 1: Fetching repository chunks`);
            const chunksResponse = await this.mcpClient.client.callTool({
                name: 'analyze_repository_code',
                arguments: { repositoryName }
            });
            
            const chunksData = JSON.parse((chunksResponse.content as any[])[0].text);
            console.log(`[ChatService] Received ${chunksData.chunks?.length || 0} chunks for processing`);
            
            if (chunksData.error) {
                return { 
                    error: chunksData.error,
                    repository: repositoryName,
                    timestamp: new Date().toISOString()
                };
            }
            
            // PHASE 2: Process each chunk with LLM
            console.log(`[ChatService] Phase 2: Processing chunks with LLM`);
            const chunkAnalyses = [];
            const totalChunks = chunksData.chunks.length;
            
            for (let i = 0; i < totalChunks; i++) {
                const chunk = chunksData.chunks[i];
                console.log(`[ChatService] Processing chunk ${i + 1}/${totalChunks} (${chunk.fileCount} files, ~${chunk.estimatedTokens} tokens)`);
                
                try {
                    const chunkAnalysis = await this.analyzeChunkWithLLM(
                        chunk, 
                        repositoryName, 
                        i + 1, 
                        totalChunks
                    );
                    chunkAnalyses.push(chunkAnalysis);
                    console.log(`[ChatService] Chunk ${i + 1} analysis completed`);
                } catch (chunkError) {
                    console.error(`[ChatService] Error analyzing chunk ${i + 1}:`, chunkError);
                    chunkAnalyses.push({
                        chunkIndex: i,
                        chunkId: chunk.chunkId,
                        analysis: `Error analyzing chunk: ${chunkError instanceof Error ? chunkError.message : 'Unknown error'}`,
                        error: true,
                        timestamp: new Date().toISOString()
                    });
                }
            }
            
            // PHASE 3: Aggregate all LLM responses
            console.log(`[ChatService] Phase 3: Aggregating LLM analyses`);
            const aggregatedAnalysis = await this.aggregateLLMAnalyses(
                chunksData, 
                chunkAnalyses, 
                repositoryName
            );
            
            console.log(`[ChatService] LLM-powered analysis completed for: ${repositoryName}`);
            return aggregatedAnalysis;
            
        } catch (error) {
            console.error(`[ChatService] Error in LLM repository analysis:`, error);
            return {
                error: `Failed to analyze repository: ${error instanceof Error ? error.message : 'Unknown error'}`,
                repository: repositoryName,
                timestamp: new Date().toISOString(),
                details: error
            };
        }
    }

    /**
     * CHUNK ANALYSIS: Analyze individual chunk with specialized LLM prompt
     */
    private async analyzeChunkWithLLM(
        chunk: any, 
        repositoryName: string, 
        chunkNumber: number, 
        totalChunks: number
    ): Promise<any> {
        
        // Create specialized analysis prompt
        const prompt = this.createChunkAnalysisPrompt(chunk, repositoryName, chunkNumber, totalChunks);
        
        try {
            console.log(`[ChatService] Sending chunk ${chunkNumber} to LLM (${chunk.estimatedTokens} tokens)`);
            
            // Call Azure OpenAI for chunk analysis
            const response = await this.openai.chat.completions.create({
                model: this.MODEL_NAME,
                messages: [
                    { role: 'system', content: this.getSDLCAnalysisSystemPrompt() },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.1, // Low temperature for consistent analysis
                max_tokens: 4000  // Limit response size
            });
            
            const analysis = response.choices[0].message.content;
            console.log(`[ChatService] LLM analysis completed for chunk ${chunkNumber}`);
            
            return {
                chunkIndex: chunk.chunkIndex,
                chunkId: chunk.chunkId,
                fileCount: chunk.fileCount,
                estimatedTokens: chunk.estimatedTokens,
                analysis: analysis,
                processingTime: new Date().toISOString(),
                llmModel: this.MODEL_NAME,
                success: true
            };
            
        } catch (error) {
            console.error(`[ChatService] Error in LLM chunk analysis:`, error);
            return {
                chunkIndex: chunk.chunkIndex,
                chunkId: chunk.chunkId,
                analysis: `Error in LLM analysis: ${error instanceof Error ? error.message : 'Unknown error'}`,
                error: true,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * PROMPT GENERATION: Create specialized prompt for chunk analysis
     */
    private createChunkAnalysisPrompt(
        chunk: any, 
        repositoryName: string, 
        chunkNumber: number, 
        totalChunks: number
    ): string {
        
        // Build files content string
        const filesContent = chunk.files.map((file: any) => 
            `\n=== FILE: ${file.path} (${file.estimatedTokens} tokens) ===\n${file.content}\n`
        ).join('\n');
        
        return `
# Repository SDLC Analysis - Chunk ${chunkNumber}/${totalChunks}

**Repository**: ${repositoryName}
**Chunk**: ${chunkNumber} of ${totalChunks}
**Files in chunk**: ${chunk.fileCount}
**Estimated tokens**: ${chunk.estimatedTokens}

## Analysis Request

Please analyze this code chunk for Software Development Lifecycle (SDLC) best practices and provide:

### 1. 🔒 Security Assessment
- Identify security vulnerabilities and risks
- Rate overall security level: HIGH/MEDIUM/LOW risk
- Provide specific actionable security recommendations

### 2. 📊 Code Quality Analysis  
- Assess code structure, maintainability, and best practices
- Identify code smells, anti-patterns, and technical debt
- Evaluate error handling and logging practices

### 3. 🔄 SDLC Compliance Review
- Evaluate testing practices and coverage indicators
- Assess documentation quality and completeness
- Check for CI/CD configuration and automation
- Review dependency management and configuration

### 4. 🚀 Technology & Architecture Assessment
- Evaluate technology choices and architecture patterns
- Identify modernization opportunities
- Review performance and scalability considerations

### 5. ⚡ Priority Recommendations
- **Immediate actions** (0-30 days): Critical issues requiring immediate attention
- **Short-term improvements** (1-3 months): Important enhancements
- **Strategic initiatives** (3+ months): Long-term architectural improvements

## Code to Analyze:
${filesContent}

Please provide a structured, actionable analysis with specific recommendations focused on improving SDLC practices.
`;
    }

    /**
     * SYSTEM PROMPT: Specialized system prompt for SDLC analysis
     */
    private getSDLCAnalysisSystemPrompt(): string {
        return `
            You are an expert Software Development Lifecycle (SDLC) consultant and security analyst with deep expertise in:

            🔹 **Security & Compliance**: Vulnerability assessment, secure coding practices, compliance frameworks
            🔹 **Code Quality**: Architecture patterns, maintainability, performance optimization
            🔹 **DevOps & CI/CD**: Automation, deployment strategies, infrastructure as code
            🔹 **Technology Assessment**: Modern frameworks, cloud-native patterns, microservices
            🔹 **SDLC Optimization**: Agile practices, team efficiency, delivery pipeline optimization

            ## Your Analysis Approach:
            1. **Thorough but focused**: Provide comprehensive analysis within token limits
            2. **Actionable insights**: Every recommendation should be specific and implementable
            3. **Risk-prioritized**: Highlight critical issues that need immediate attention
            4. **Context-aware**: Consider the specific technology stack and business context
            5. **Best practices**: Reference industry standards and proven methodologies

            ## Response Format:
            - Use clear headings and bullet points for readability
            - Prioritize findings by severity and impact
            - Include specific code examples and snippets for better understanding and readability of issues (make sure to always do this)
            - Provide concrete next steps for each recommendation
            - Focus on practical, implementable solutions

            Remember: Your goal is to help development teams build secure, maintainable, and scalable software systems.
            `;
    }

    /**
     * AGGREGATION: Combine all chunk analyses into comprehensive report
     */
    private async aggregateLLMAnalyses(
        chunksData: any, 
        chunkAnalyses: any[], 
        repositoryName: string
    ): Promise<any> {
        
        // Filter successful analyses
        const successfulAnalyses = chunkAnalyses.filter(analysis => !analysis.error);
        const failedAnalyses = chunkAnalyses.filter(analysis => analysis.error);
        
        if (successfulAnalyses.length === 0) {
            return {
                repository: repositoryName,
                error: 'All chunk analyses failed',
                failedChunks: failedAnalyses,
                timestamp: new Date().toISOString()
            };
        }
        
        // Combine all successful analyses
        const combinedAnalyses = successfulAnalyses
            .map(analysis => `## Chunk ${analysis.chunkIndex + 1} Analysis\n${analysis.analysis}`)
            .join('\n\n---\n\n');
        
        // Create aggregation prompt
        const aggregationPrompt = `
# Repository Comprehensive SDLC Assessment

**Repository**: ${repositoryName}
**Analysis Method**: LLM-Powered Chunked Analysis
**Chunks Processed**: ${successfulAnalyses.length}/${chunkAnalyses.length}
**Total Files Analyzed**: ${chunksData.summary.relevantFiles}
**Technology Stack**: ${chunksData.summary.technologies.join(', ')}

## Task: Synthesize Comprehensive SDLC Report

I have completed detailed analysis of ${successfulAnalyses.length} code chunks from this repository. Please synthesize these individual analyses into a comprehensive, executive-ready SDLC assessment report.

### Required Report Sections:

#### 🎯 Executive Summary
- Overall security risk assessment (HIGH/MEDIUM/LOW)
- Code quality and maintainability score
- SDLC maturity level and key gaps
- Business impact of findings

#### 🔍 Key Findings & Insights
- **Critical Issues**: Most severe problems requiring immediate attention
- **Security Concerns**: Consolidated security vulnerabilities and risks
- **Code Quality Issues**: Technical debt, maintainability concerns
- **SDLC Gaps**: Missing or inadequate development lifecycle practices

#### 📋 Prioritized Action Plan
- **🚨 Immediate Actions (0-30 days)**: Critical fixes and security patches
- **📈 Short-term Improvements (1-3 months)**: Quality enhancements and process improvements
- **🎯 Strategic Initiatives (3-12 months)**: Architectural improvements and modernization

#### 🛠️ Implementation Roadmap
- Specific implementation steps for each priority area
- Resource requirements and estimated effort
- Success metrics and measurement criteria
- Risk mitigation strategies

#### 📊 Summary Metrics
- Total issues identified by severity
- Estimated technical debt and remediation effort
- Compliance and security posture
- Recommended investment priorities

## Individual Chunk Analyses to Synthesize:

${combinedAnalyses}

Please provide a comprehensive, actionable SDLC assessment that executives and development teams can use to improve their software development practices.
`;
        
        try {
            console.log(`[ChatService] Aggregating ${successfulAnalyses.length} chunk analyses with LLM`);
            
            // Call LLM for aggregation
            const response = await this.openai.chat.completions.create({
                model: this.MODEL_NAME,
                messages: [
                    { role: 'system', content: this.getSDLCAnalysisSystemPrompt() },
                    { role: 'user', content: aggregationPrompt }
                ],
                temperature: 0.2, // Slightly higher for creative synthesis
                max_tokens: 6000  // Larger response for comprehensive report
            });
            
            return {
                repository: repositoryName,
                analysisMethod: 'LLM-Powered Chunked Analysis',
                timestamp: new Date().toISOString(),
                
                // Repository summary
                repositorySummary: {
                    totalFiles: chunksData.summary.totalFilesInRepo,
                    analyzedFiles: chunksData.summary.relevantFiles,
                    technologies: chunksData.summary.technologies,
                    basicStructure: chunksData.summary.basicStructure
                },
                
                // Processing information
                processingDetails: {
                    totalChunks: chunkAnalyses.length,
                    successfulChunks: successfulAnalyses.length,
                    failedChunks: failedAnalyses.length,
                    llmModel: this.MODEL_NAME,
                    averageTokensPerChunk: Math.round(
                        successfulAnalyses.reduce((sum, a) => sum + (a.estimatedTokens || 0), 0) / successfulAnalyses.length
                    )
                },
                
                // Main comprehensive analysis
                comprehensiveAnalysis: response.choices[0].message.content,
                
                // Individual chunk details (for reference)
                chunkAnalyses: successfulAnalyses.map(analysis => ({
                    chunkIndex: analysis.chunkIndex,
                    fileCount: analysis.fileCount,
                    success: analysis.success,
                    processingTime: analysis.processingTime
                })),
                
                // Error details if any
                ...(failedAnalyses.length > 0 && {
                    processingErrors: failedAnalyses.map(analysis => ({
                        chunkIndex: analysis.chunkIndex,
                        error: analysis.analysis
                    }))
                }),
                
                // Metadata
                metadata: {
                    generatedAt: new Date().toISOString(),
                    analysisType: 'Comprehensive SDLC Assessment',
                    processingMethod: 'Real-time LLM chunk analysis with intelligent aggregation'
                }
            };
            
        } catch (error) {
            console.error(`[ChatService] Error in aggregation:`, error);
            
            // Fallback: return individual analyses if aggregation fails
            return {
                repository: repositoryName,
                analysisMethod: 'LLM-Powered Chunked Analysis (Individual Reports)',
                timestamp: new Date().toISOString(),
                repositorySummary: chunksData.summary,
                processingDetails: {
                    totalChunks: chunkAnalyses.length,
                    successfulChunks: successfulAnalyses.length,
                    failedChunks: failedAnalyses.length
                },
                individualAnalyses: successfulAnalyses,
                aggregationError: `Failed to create comprehensive report: ${error instanceof Error ? error.message : 'Unknown error'}`,
                fallbackNote: 'Individual chunk analyses provided due to aggregation failure'
            };
        }
    }
}

export const chatService = new ChatService();