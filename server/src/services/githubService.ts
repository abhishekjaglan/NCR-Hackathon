import { GITHUB_BASE_URL, GITHUB_ORG, GITHUB_TOKEN } from "../utils/config";


export class GitHubApiService {
  private baseUrl: string;
  private headers: Record<string, string>;
  private org: string;
  private token: string;

  constructor(baseUrl: string = GITHUB_BASE_URL, token: string = GITHUB_TOKEN, org: string = GITHUB_ORG) {
    this.baseUrl = baseUrl;
    this.org = org;
    this.token = token;
    
    if (!token || token.length < 10) {
      console.error('[GitHubApiService] Invalid or missing GitHub token');
      throw new Error('GitHub token is required and must be valid');
    }
    
    console.log(`[GitHubApiService] Token present: ${!!token}`);
    console.log(`[GitHubApiService] Token prefix: ${token.substring(0, 4)}...`);
    console.log(`[GitHubApiService] Org: ${org}`);
    console.log(`[GitHubApiService] Base URL: ${baseUrl}`);
    
    this.headers = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'JIRA-MCP-GitHub-Integration'
    };
  }

  private async fetchJson(endpoint: string): Promise<any> {
    const url = `${this.baseUrl}${endpoint}`;
    console.log(`[GitHubApiService] Fetching: ${url}`);
    
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: this.headers
      });

      if (!response.ok) {
        console.error(`[GitHubApiService] Error ${response.status}: ${response.statusText}`);
        return null;
      }

      const data = await response.json();
      console.log(`[GitHubApiService] Success: received data`);
      return data;
    } catch (error) {
      console.error(`[GitHubApiService] Error fetching ${url}:`, error);
      return null;
    }
  }

  // Test method to verify authentication works
  async testAuthentication(): Promise<boolean> {
    try {
      console.log('[GitHubApiService] Testing authentication...');
      const user = await this.fetchJson('/user');
      if (user && user.login) {
        console.log(`[GitHubApiService] Authentication successful. User: ${user.login}`);
        return true;
      } else {
        console.error('[GitHubApiService] Authentication failed - no user data returned');
        return false;
      }
    } catch (error) {
      console.error('[GitHubApiService] Authentication test failed:', error);
      return false;
    }
  }
  
  async getRepositoryMetadata(repositoryName: string): Promise<any> {
    try {
      console.log(`[GitHubApiService] Fetching repository metadata for: ${repositoryName}`);
      
      // Construct the endpoint for the specific repository
      const endpoint = `/repos/${this.org}/${repositoryName}`;
      const repoData = await this.fetchJson(endpoint);
      
      if (!repoData) {
        console.error(`[GitHubApiService] Repository not found: ${repositoryName}`);
        return null;
      }

      console.log(`[GitHubApiService] Successfully retrieved metadata for repository: ${repositoryName}`);
      return repoData;
    } catch (error) {
      console.error(`[GitHubApiService] Error fetching repository metadata for ${repositoryName}:`, error);
      return null;
    }
  }

  async getRepositoryCode(repositoryName: string, branch: string = 'main'): Promise<any> {
    try {
      console.log(`[GitHubApiService] Fetching all code for repository: ${repositoryName} on branch: ${branch}`);
      
      // First, get the repository tree recursively
      const treeEndpoint = `/repos/${this.org}/${repositoryName}/git/trees/${branch}?recursive=1`;
      const treeData = await this.fetchJson(treeEndpoint);
      
      if (!treeData || !treeData.tree) {
        console.error(`[GitHubApiService] Repository tree not found for: ${repositoryName}`);
        return null;
      }

      const files: any[] = [];
      const filesToFetch = treeData.tree.filter((item: any) => item.type === 'blob');
      
      console.log(`[GitHubApiService] Found ${filesToFetch.length} files to fetch`);

      // Fetch content for each file
      for (const file of filesToFetch) {
        try {
          console.log(`[GitHubApiService] Fetching content for: ${file.path}`);
          
          // Get file content using the blob SHA
          const contentEndpoint = `/repos/${this.org}/${repositoryName}/git/blobs/${file.sha}`;
          const contentData = await this.fetchJson(contentEndpoint);
          
          if (contentData && contentData.content) {
            // Decode base64 content
            const decodedContent = Buffer.from(contentData.content, 'base64').toString('utf-8');
            
            files.push({
              path: file.path,
              sha: file.sha,
              size: file.size,
              url: file.url,
              content: decodedContent,
              encoding: contentData.encoding
            });
          } else {
            console.warn(`[GitHubApiService] Could not fetch content for: ${file.path}`);
            files.push({
              path: file.path,
              sha: file.sha,
              size: file.size,
              url: file.url,
              content: null,
              error: 'Could not fetch content'
            });
          }
        } catch (fileError) {
          console.error(`[GitHubApiService] Error fetching content for ${file.path}:`, fileError);
          files.push({
            path: file.path,
            sha: file.sha,
            size: file.size,
            url: file.url,
            content: null,
            error: fileError instanceof Error ? fileError.message : 'Unknown error'
          });
        }
      }

      const result = {
        repository: repositoryName,
        branch: branch,
        totalFiles: files.length,
        files: files,
        tree: treeData.tree
      };

      console.log(`[GitHubApiService] Successfully retrieved code for repository: ${repositoryName} (${files.length} files)`);
      return result;
    } catch (error) {
      console.error(`[GitHubApiService] Error fetching repository code for ${repositoryName}:`, error);
      return null;
    }
  }

// /**
//  * Analyzes repository code with strict token limit enforcement
//  */
// async analyzeRepositoryCode(
//     repositoryName: string,
//     branch: string = 'main',
//     maxTokensPerChunk: number = 75000, // Fixed: Was 100000, but with safety margins this is more realistic
//     maxFilesPerChunk: number = 20,
//     excludePatterns: string[] = ['node_modules', '.git', 'dist', 'build', '.next', 'coverage', 'vendor', 'target', 'package-lock.json']
// ): Promise<any> {
//     try {
//         console.log(`[GitHubApiService] Starting token-limited code analysis for repository: ${repositoryName}`);
//         console.log(`[GitHubApiService] Token limit per chunk: ${maxTokensPerChunk} (Model limit: 128K)`);
        
//         // Fetch repository code
//         const repoCode = await this.getRepositoryCode(repositoryName, branch);
        
//         if (!repoCode || !repoCode.files) {
//             return {
//                 error: `Repository code not found for: ${repositoryName}`,
//                 repository: repositoryName,
//                 branch: branch,
//                 timestamp: new Date().toISOString()
//             };
//         }

//         console.log(`[GitHubApiService] Repository fetched: ${repoCode.totalFiles} total files`);

//         // Filter files to include only code/config files
//         interface RepositoryFile {
//             path: string;
//             sha: string;
//             size: number;
//             url: string;
//             content: string | null;
//             encoding?: string;
//             error?: string;
//         }

//         const filteredFiles: RepositoryFile[] = repoCode.files.filter((file: RepositoryFile) => {
//             const path: string = file.path.toLowerCase();
            
//             // Exclude patterns
//             for (const pattern of excludePatterns) {
//                 if (path.includes(pattern.toLowerCase())) {
//                     return false;
//                 }
//             }
            
//             // Include only relevant file types
//             const relevantExtensions: string[] = [
//                 '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.cs', '.go', '.rb', '.php', 
//                 '.cpp', '.c', '.h', '.json', '.yml', '.yaml', '.xml', '.sql', '.md', 
//                 '.txt', '.env', '.config', '.toml', '.ini', '.sh', '.bat', '.ps1'
//             ];
            
//             return relevantExtensions.some((ext: string) => path.endsWith(ext)) || 
//                    path.includes('dockerfile') || 
//                    path.includes('makefile') ||
//                    path.includes('readme') ||
//                    path.includes('license');
//         });

//         // Filter out files without content or with errors
//         interface FileWithContent {
//             path: string;
//             sha: string;
//             size: number;
//             url: string;
//             content: string | null;
//             encoding?: string;
//             error?: string;
//         }

//         interface ValidFile extends FileWithContent {
//             content: string;
//             error?: never;
//         }

//         const validFiles: ValidFile[] = filteredFiles.filter((file): file is ValidFile => file.content != null && !file.error);
        
//         console.log(`[GitHubApiService] After filtering: ${validFiles.length} valid files from ${filteredFiles.length} filtered files`);

//         // Estimate total content size in tokens
//         const totalTokens = validFiles.reduce((sum, file) => 
//             sum + this.estimateTokenCount(file.content || ''), 0
//         );
        
//         console.log(`[GitHubApiService] Estimated total content tokens: ${totalTokens}`);

//         // Create token-aware chunks with CORRECT parameters
//         const chunks = this.chunkFilesByTokenLimit(
//             validFiles, 
//             maxTokensPerChunk,      // This was being passed as 'maxFilesPerChunk' before!
//             maxFilesPerChunk,       // This was being passed as excludePatterns before!
//             15000                   // Reserve tokens
//         );

//         // Generate basic analysis without token-heavy operations
//         const technologies = this.detectTechnologies(validFiles);
//         const projectStructure = this.analyzeProjectStructure(validFiles);

//         const result = {
//             repository: repositoryName,
//             branch: branch,
//             timestamp: new Date().toISOString(),
//             tokenLimits: {
//                 modelContextLimit: 128000,
//                 chunkTokenLimit: maxTokensPerChunk,
//                 estimatedTotalTokens: totalTokens,
//                 chunksCreated: chunks.length,
//                 actualMaxChunkTokens: chunks.length > 0 ? Math.max(...chunks.map(chunk => 
//                     chunk.reduce((sum, file) => sum + (file.estimatedTokens || 0), 0)
//                 )) : 0
//             },
//             summary: {
//                 totalFilesInRepo: repoCode.totalFiles,
//                 filteredFiles: filteredFiles.length,
//                 validFiles: validFiles.length,
//                 excludedFiles: repoCode.totalFiles - validFiles.length,
//                 totalChunks: chunks.length,
//                 technologies: technologies,
//                 projectStructure: projectStructure,
//                 filesProcessed: chunks.reduce((sum, chunk) => sum + chunk.length, 0)
//             },
//             chunkingConfig: {
//                 maxTokensPerChunk,
//                 maxFilesPerChunk,
//                 excludePatterns
//             },
//             chunks: chunks.map((chunk, index) => {
//                 const chunkTokens = chunk.reduce((sum, file) => 
//                     sum + (file.estimatedTokens || 0), 0
//                 );
                
//                 return {
//                     chunkIndex: index,
//                     fileCount: chunk.length,
//                     estimatedTokens: chunkTokens,
//                     tokenLimitRespected: chunkTokens <= maxTokensPerChunk,
//                     files: chunk.map(file => ({
//                         path: file.path,
//                         size: file.size,
//                         contentLength: file.content ? file.content.length : 0,
//                         estimatedTokens: file.estimatedTokens,
//                         extension: this.getFileExtension(file.path),
//                         content: file.content // Full content for processing
//                     }))
//                 };
//             }),
//             skippedFiles: validFiles.filter(file => {
//                 const fileTokens = this.estimateTokenCount(file.content || '') + 200; // Add overhead
//                 return fileTokens > (maxTokensPerChunk - 15000 - 5000); // Too large for any chunk
//             }).map(file => ({
//                 path: file.path,
//                 reason: 'File too large for chunking',
//                 estimatedTokens: this.estimateTokenCount(file.content || '')
//             })),
//             metadata: {
//                 processingTime: new Date().toISOString(),
//                 tokenEstimationMethod: "1 token ≈ 3.5 characters",
//                 safetyMargin: "15K tokens reserved for response",
//                 largestChunkTokens: chunks.length > 0 ? Math.max(...chunks.map(chunk => 
//                     chunk.reduce((sum, file) => sum + (file.estimatedTokens || 0), 0)
//                 )) : 0,
//                 smallestChunkTokens: chunks.length > 0 ? Math.min(...chunks.map(chunk => 
//                     chunk.reduce((sum, file) => sum + (file.estimatedTokens || 0), 0)
//                 )) : 0
//             }
//         };

//         console.log(`[GitHubApiService] Analysis completed with token safety`);
//         console.log(`[GitHubApiService] Created ${result.chunks.length} chunks, largest: ~${result.metadata.largestChunkTokens} tokens`);
//         console.log(`[GitHubApiService] Files processed: ${result.summary.filesProcessed}/${result.summary.validFiles}`);

//         // Final safety check
//         const maxChunkTokens = result.metadata.largestChunkTokens;
//         if (maxChunkTokens > maxTokensPerChunk) {
//             console.error(`[GitHubApiService] ERROR: Chunk exceeds token limit! ${maxChunkTokens} > ${maxTokensPerChunk}`);
//         }

//         return result;
//     } catch (error) {
//         console.error(`[GitHubApiService] Error in token-limited repository analysis:`, error);
//         throw error;
//     }
// }

//   // OG analyzeRepositoryCode method
//   // Uncomment and modify as needed for your specific analysis requirements
// //   async analyzeRepositoryCode(
// //         repositoryName: string,
// //         branch: string = 'main',
// //         maxFiles: number = 20,
// //         includePatterns: string[] = [],
// //         excludePatterns: string[] = []
// //     ): Promise<any> {
// //         try {
// //             console.log(`[GitHubServer] Starting code analysis for repository: ${repositoryName}`);
            
// //             // Fetch repository code
// //             const repoCode = await this.getRepositoryCode(repositoryName, branch);
            
// //             if (!repoCode || !repoCode.files) {
// //                 return {
// //                     error: `Repository code not found for: ${repositoryName}`,
// //                     repository: repositoryName,
// //                     branch: branch
// //                 };
// //             }

// //             // // Filter and prioritize files for analysis
// //             // const filteredFiles = this.filterAndPrioritizeFiles(
// //             //     repoCode.files,
// //             //     includePatterns,
// //             //     excludePatterns,
// //             //     maxFiles
// //             // );

// //             // console.log(`[GitHubServer] Analyzing ${filteredFiles.length} files out of ${repoCode.totalFiles} total files`);

// //             // // Analyze each file
// //             // const fileAnalyses = filteredFiles.map(file => this.analyzeFile(file));

// //             // // Generate comprehensive analysis
// //             // const analysis = {
// //             //     repository: repositoryName,
// //             //     branch: branch,
// //             //     timestamp: new Date().toISOString(),
// //             //     summary: {
// //             //         totalFiles: repoCode.totalFiles,
// //             //         analyzedFiles: filteredFiles.length,
// //             //         technologies: this.detectTechnologies(filteredFiles),
// //             //         projectStructure: this.analyzeProjectStructure(filteredFiles)
// //             //     },
// //             //     recommendations: {
// //             //         security: this.generateSecurityRecommendations(fileAnalyses),
// //             //         privacy: this.generatePrivacyRecommendations(fileAnalyses),
// //             //         codeQuality: this.generateCodeQualityRecommendations(fileAnalyses),
// //             //         sdlc: this.generateSDLCRecommendations(filteredFiles, fileAnalyses),
// //             //         technology: this.generateTechnologyRecommendations(filteredFiles, fileAnalyses)
// //             //     },
// //             //     fileAnalyses: fileAnalyses.slice(0, 10), // Limit detailed file analysis to save tokens
// //             //     riskAssessment: this.generateRiskAssessment(fileAnalyses),
// //             //     actionItems: this.generateActionItems(fileAnalyses)
// //             // };

// //             // return analysis;
// //             return repoCode;
// //         } catch (error) {
// //             console.error(`[GitHubServer] Error analyzing repository code:`, error);
// //             throw error;
// //         }
// //     }

//     filterAndPrioritizeFiles(
//         files: any[],
//         includePatterns: string[],
//         excludePatterns: string[],
//         maxFiles: number
//     ): any[] {
//         // Priority order for file types
//         const priorities = {
//             'package.json': 10,
//             'requirements.txt': 10,
//             'Dockerfile': 9,
//             'docker-compose.yml': 9,
//             '.env': 8,
//             'config': 7,
//             'security': 7,
//             'auth': 7,
//             'index': 6,
//             'main': 6,
//             'app': 6,
//             'server': 5,
//             'api': 5,
//             'service': 4,
//             'controller': 4,
//             'model': 3,
//             'util': 2,
//             'test': 1
//         };

//         // Filter files
//         let filteredFiles = files.filter(file => {
//             const path = file.path.toLowerCase();
            
//             // Exclude patterns
//             for (const pattern of excludePatterns) {
//                 if (path.includes(pattern.toLowerCase())) {
//                     return false;
//                 }
//             }
            
//             // Include patterns (if specified)
//             if (includePatterns.length > 0) {
//                 let matches = false;
//                 for (const pattern of includePatterns) {
//                     if (path.includes(pattern.toLowerCase().replace('*', ''))) {
//                         matches = true;
//                         break;
//                     }
//                 }
//                 if (!matches) return false;
//             }
            
//             // Only include text files that are likely to contain code
//             const codeExtensions = ['.js', '.ts', '.py', '.java', '.cs', '.go', '.rb', '.php', '.cpp', '.c', '.h', '.json', '.yml', '.yaml', '.xml', '.sql', '.md', '.txt', '.env', '.config'];
//             return codeExtensions.some(ext => path.endsWith(ext)) || path.includes('dockerfile');
//         });

//         // Sort by priority and size
//         filteredFiles.sort((a, b) => {
//             const aPriority = this.getFilePriority(a.path, priorities);
//             const bPriority = this.getFilePriority(b.path, priorities);
            
//             if (aPriority !== bPriority) {
//                 return bPriority - aPriority; // Higher priority first
//             }
            
//             // If same priority, prefer smaller files to avoid token limits
//             return (a.size || 0) - (b.size || 0);
//         });

//         // Limit to maxFiles and exclude very large files
//         return filteredFiles
//             .filter(file => (file.size || 0) < 50000) // Exclude files > 50KB
//             .slice(0, maxFiles);
//     }

//     getFilePriority(path: string, priorities: Record<string, number>): number {
//         const lowerPath = path.toLowerCase();
//         for (const [key, priority] of Object.entries(priorities)) {
//             if (lowerPath.includes(key)) {
//                 return priority;
//             }
//         }
//         return 0;
//     }

//     analyzeFile(file: any): any {
//         if (!file.content) {
//             return {
//                 path: file.path,
//                 size: file.size,
//                 error: 'No content available'
//             };
//         }

//         const content = file.content;
//         const lines = content.split('\n');
        
//         return {
//             path: file.path,
//             size: file.size,
//             lines: lines.length,
//             extension: this.getFileExtension(file.path),
//             securityIssues: this.detectSecurityIssues(content, file.path),
//             privacyIssues: this.detectPrivacyIssues(content, file.path),
//             codeQualityIssues: this.detectCodeQualityIssues(content, file.path),
//             dependencies: this.extractDependencies(content, file.path),
//             configurationIssues: this.detectConfigurationIssues(content, file.path),
//             summary: this.generateFileSummary(content, file.path)
//         };
//     }

    detectTechnologies(files: any[]): string[] {
        const technologies = new Set<string>();
        
        files.forEach(file => {
            const path = file.path.toLowerCase();
            const ext = this.getFileExtension(path);
            
            // Detect by file extension
            const techMap: Record<string, string> = {
                '.js': 'JavaScript',
                '.ts': 'TypeScript',
                '.py': 'Python',
                '.java': 'Java',
                '.cs': 'C#',
                '.go': 'Go',
                '.rb': 'Ruby',
                '.php': 'PHP',
                '.cpp': 'C++',
                '.c': 'C'
            };
            
            if (techMap[ext]) {
                technologies.add(techMap[ext]);
            }
            
            // Detect by filename
            if (path.includes('package.json')) technologies.add('Node.js');
            if (path.includes('requirements.txt')) technologies.add('Python');
            if (path.includes('dockerfile')) technologies.add('Docker');
            if (path.includes('docker-compose')) technologies.add('Docker Compose');
            if (path.includes('.env')) technologies.add('Environment Variables');
        });
        
        return Array.from(technologies);
    }

//     analyzeProjectStructure(files: any[]): any {
//         const structure = {
//             hasTests: false,
//             hasDocumentation: false,
//             hasConfigFiles: false,
//             hasSecurityFiles: false,
//             hasCICD: false,
//             directories: new Set<string>()
//         };
        
//         files.forEach(file => {
//             const path = file.path.toLowerCase();
            
//             if (path.includes('test') || path.includes('spec')) structure.hasTests = true;
//             if (path.includes('readme') || path.includes('doc')) structure.hasDocumentation = true;
//             if (path.includes('config') || path.includes('.env')) structure.hasConfigFiles = true;
//             if (path.includes('security') || path.includes('auth')) structure.hasSecurityFiles = true;
//             if (path.includes('.github') || path.includes('ci') || path.includes('pipeline')) structure.hasCICD = true;
            
//             const dir = path.split('/')[0];
//             structure.directories.add(dir);
//         });
        
//         return {
//             ...structure,
//             directories: Array.from(structure.directories)
//         };
//     }

    // Helper methods for file analysis
    getFileExtension(path: string): string {
        const parts = path.split('.');
        return parts.length > 1 ? '.' + parts[parts.length - 1] : '';
    }

//     detectSecurityIssues(content: string, path: string): string[] {
//         const issues = [];
        
//         // Check for common security issues
//         if (content.includes('password') && content.includes('=')) {
//             issues.push("Potential hardcoded password detected");
//         }
//         if (content.includes('api_key') || content.includes('apikey')) {
//             issues.push("Potential API key exposure");
//         }
//         if (content.includes('eval(') || content.includes('exec(')) {
//             issues.push("Use of eval/exec functions detected - security risk");
//         }
//         if (content.includes('innerHTML')) {
//             issues.push("Use of innerHTML - potential XSS vulnerability");
//         }
        
//         return issues;
//     }

//     detectPrivacyIssues(content: string, path: string): string[] {
//         const issues = [];
        
//         // Check for privacy-related issues
//         if (content.includes('email') || content.includes('phone')) {
//             issues.push("Personal data handling detected - ensure GDPR compliance");
//         }
//         if (content.includes('tracking') || content.includes('analytics')) {
//             issues.push("Tracking/analytics code detected - ensure user consent");
//         }
        
//         return issues;
//     }

//     private detectCodeQualityIssues(content: string, path: string): string[] {
//         const issues = [];
        
//         // Check for code quality issues
//         if (content.includes('TODO') || content.includes('FIXME')) {
//             issues.push("TODO/FIXME comments found - needs attention");
//         }
//         if (content.includes('console.log') && !path.includes('test')) {
//             issues.push("Console.log statements found - consider proper logging");
//         }
        
//         return issues;
//     }

//     private extractDependencies(content: string, path: string): string[] {
//         const dependencies = [];
        
//         if (path.includes('package.json')) {
//             try {
//                 const packageJson = JSON.parse(content);
//                 if (packageJson.dependencies) {
//                     dependencies.push(...Object.keys(packageJson.dependencies));
//                 }
//             } catch (e) {
//                 // Ignore parsing errors
//             }
//         }
        
//         return dependencies;
//     }

//     private detectConfigurationIssues(content: string, path: string): string[] {
//         const issues = [];
        
//         if (path.includes('.env') && !path.includes('example')) {
//             issues.push("Environment file detected - ensure it's not committed to repository");
//         }
        
//         return issues;
//     }

//     private generateFileSummary(content: string, path: string): string {
//         const lines = content.split('\n').length;
//         const extension = this.getFileExtension(path);
        
//         return `${extension} file with ${lines} lines`;
//     }

    /**
     * Estimates token count for content (rough approximation: 1 token ≈ 4 characters)
     * @param content String content to estimate
     * @returns Estimated token count
     */
    private estimateTokenCount(content: string): number {
        // Conservative estimate: 1 token = 3.5 characters (including overhead)
        return Math.ceil(content.length / 3.5);
    }

//     /**
//  * Chunks files while respecting token limits and prioritizing important files
//  * @param files Array of files to chunk
//  * @param maxTokensPerChunk Maximum tokens per chunk
//  * @param maxFilesPerChunk Maximum files per chunk
//  * @param reserveTokens Tokens to reserve for response and overhead
//  * @returns Array of file chunks that respect token limits
//  */
//     private chunkFilesByTokenLimit(
//         files: any[], 
//         maxTokensPerChunk: number = 75000,
//         maxFilesPerChunk: number = 20,
//         reserveTokens: number = 15000
//     ): any[][] {
//         const chunks: any[][] = [];
        
//         // Account for base overhead (metadata, structure, etc.)
//         const baseOverheadTokens = 5000;
//         const effectiveMaxTokens = maxTokensPerChunk - reserveTokens - baseOverheadTokens;

//         console.log(`[GitHubApiService] Starting token-aware chunking for ${files.length} files`);
//         console.log(`[GitHubApiService] Effective max tokens per chunk: ${effectiveMaxTokens}`);

//         // Priority order for files (higher number = higher priority)
//         const getFilePriority = (path: string): number => {
//             const lowerPath = path.toLowerCase();
            
//             // Critical configuration files
//             if (lowerPath.includes('package.json')) return 100;
//             if (lowerPath.includes('dockerfile')) return 95;
//             if (lowerPath.includes('docker-compose')) return 90;
//             if (lowerPath.includes('tsconfig.json')) return 85;
//             if (lowerPath.includes('.env') && !lowerPath.includes('example')) return 80;
            
//             // Important source files
//             if (lowerPath.includes('index.') || lowerPath.includes('main.')) return 75;
//             if (lowerPath.includes('app.')) return 70;
//             if (lowerPath.includes('server.')) return 65;
//             if (lowerPath.includes('config.')) return 60;
            
//             // Regular source files
//             if (lowerPath.endsWith('.ts') || lowerPath.endsWith('.tsx')) return 50;
//             if (lowerPath.endsWith('.js') || lowerPath.endsWith('.jsx')) return 45;
            
//             // Documentation and other files
//             if (lowerPath.includes('readme')) return 25;
//             if (lowerPath.endsWith('.md')) return 20;
//             if (lowerPath.endsWith('.json')) return 15;
            
//             return 10; // Default priority
//         };

//         // Sort files by priority (highest first), then by size (smallest first within same priority)
//         const sortedFiles = [...files].sort((a, b) => {
//             const aPriority = getFilePriority(a.path);
//             const bPriority = getFilePriority(b.path);
            
//             if (aPriority !== bPriority) {
//                 return bPriority - aPriority; // Higher priority first
//             }
            
//             // Same priority, prefer smaller files to fit more in chunks
//             const aTokens = this.estimateTokenCount(a.content || '');
//             const bTokens = this.estimateTokenCount(b.content || '');
//             return aTokens - bTokens;
//         });

//         // Process files and create chunks
//         let currentChunk: any[] = [];
//         let currentChunkTokens = 0;
//         const oversizedFiles: any[] = [];

//         for (const file of sortedFiles) {
//             if (!file.content) continue;
            
//             const fileTokens = this.estimateTokenCount(file.content);
//             const fileMetadataTokens = this.estimateTokenCount(JSON.stringify({
//                 path: file.path,
//                 size: file.size,
//                 extension: this.getFileExtension(file.path)
//             }));
            
//             const totalFileTokens = fileTokens + fileMetadataTokens + 100; // Structure overhead
            
//             // Skip files that are too large for any chunk
//             if (totalFileTokens > effectiveMaxTokens) {
//                 console.warn(`[GitHubApiService] Skipping oversized file: ${file.path} (${totalFileTokens} tokens)`);
//                 oversizedFiles.push({
//                     ...file,
//                     estimatedTokens: totalFileTokens,
//                     reason: 'File exceeds chunk limit'
//                 });
//                 continue;
//             }
            
//             // Check if adding this file would exceed limits
//             const wouldExceedTokens = currentChunkTokens + totalFileTokens > effectiveMaxTokens;
//             const wouldExceedFileCount = currentChunk.length >= maxFilesPerChunk;
            
//             // Start new chunk if limits would be exceeded
//             if ((wouldExceedTokens || wouldExceedFileCount) && currentChunk.length > 0) {
//                 console.log(`[GitHubApiService] Chunk ${chunks.length + 1} completed: ${currentChunk.length} files, ~${currentChunkTokens} tokens`);
//                 chunks.push([...currentChunk]);
//                 currentChunk = [];
//                 currentChunkTokens = 0;
//             }
            
//             // Add file to current chunk
//             currentChunk.push({
//                 ...file,
//                 estimatedTokens: totalFileTokens,
//                 priority: getFilePriority(file.path)
//             });
//             currentChunkTokens += totalFileTokens;
            
//             // Log important files being added
//             const priority = getFilePriority(file.path);
//             if (priority >= 60 || totalFileTokens > 1000) {
//                 console.log(`[GitHubApiService] Added ${priority >= 60 ? 'important' : 'large'} file: ${file.path} (priority: ${priority}, ~${totalFileTokens} tokens)`);
//             }
//         }
        
//         // Add final chunk
//         if (currentChunk.length > 0) {
//             console.log(`[GitHubApiService] Final chunk ${chunks.length + 1}: ${currentChunk.length} files, ~${currentChunkTokens} tokens`);
//             chunks.push(currentChunk);
//         }
        
//         console.log(`[GitHubApiService] Token-aware chunking completed:`);
//         console.log(`[GitHubApiService] - Created ${chunks.length} chunks`);
//         console.log(`[GitHubApiService] - Processed ${chunks.reduce((sum, chunk) => sum + chunk.length, 0)} files`);
//         console.log(`[GitHubApiService] - Skipped ${oversizedFiles.length} oversized files`);
        
//         // Validate all chunks are within limits
//         chunks.forEach((chunk, index) => {
//             const chunkTokens = chunk.reduce((sum, file) => sum + (file.estimatedTokens || 0), 0);
//             const highPriorityFiles = chunk.filter(f => f.priority >= 60).length;
            
//             console.log(`[GitHubApiService] Chunk ${index + 1}: ${chunk.length} files, ${chunkTokens} tokens, ${highPriorityFiles} high-priority files`);
            
//             if (chunkTokens > effectiveMaxTokens) {
//                 console.error(`[GitHubApiService] WARNING: Chunk ${index + 1} exceeds token limit: ${chunkTokens} > ${effectiveMaxTokens}`);
//             }
//         });
        
//         return chunks;
//     }

  /**
   * NEW: Main orchestrator for chunked repository analysis
   * Returns file chunks for client-side LLM processing
   */
  async getRepositoryChunks(
      repositoryName: string,
      branch: string = 'main',
      maxTokensPerChunk: number = 100000,
      excludePatterns: string[] = ['node_modules', '.git', 'dist', 'build', '.next', 'coverage', 'vendor', 'target']
  ): Promise<any> {
      try {
          console.log(`[GitHubApiService] Starting chunked repository analysis for: ${repositoryName}`);
          
          // Step 1: Fetch repository code
          const repoCode = await this.getRepositoryCode(repositoryName, branch);
          if (!repoCode?.files) {
              return { 
                  error: `Repository code not found for: ${repositoryName}`,
                  repository: repositoryName,
                  branch: branch
              };
          }

          // Step 2: Filter relevant files (no internal analysis)
          const relevantFiles = this.filterRelevantFiles(repoCode.files, excludePatterns);
          console.log(`[GitHubApiService] Filtered to ${relevantFiles.length} relevant files from ${repoCode.totalFiles} total`);

          // Step 3: Create intelligent chunks for LLM processing
          const chunks = this.createLLMOptimizedChunks(relevantFiles, maxTokensPerChunk);
          
          // Step 4: Basic repository metadata (no heavy analysis)
          const technologies = this.detectTechnologies(relevantFiles);
          const basicStructure = this.analyzeBasicStructure(relevantFiles);

          return {
              repository: repositoryName,
              branch: branch,
              timestamp: new Date().toISOString(),
              summary: {
                  totalFilesInRepo: repoCode.totalFiles,
                  relevantFiles: relevantFiles.length,
                  totalChunks: chunks.length,
                  technologies: technologies,
                  basicStructure: basicStructure
              },
              chunks: chunks.map((chunk, index) => ({
                  chunkIndex: index,
                  chunkId: `${repositoryName}-chunk-${index}`,
                  fileCount: chunk.length,
                  estimatedTokens: chunk.reduce((sum, file) => sum + (file.estimatedTokens || 0), 0),
                  files: chunk.map(file => ({
                      path: file.path,
                      content: file.content,
                      size: file.size,
                      extension: this.getFileExtension(file.path),
                      priority: file.priority,
                      estimatedTokens: file.estimatedTokens
                  }))
              })),
              processingInstructions: {
                  method: "Send each chunk to LLM for analysis",
                  prompt: "Analyze this code chunk for SDLC practices, security, and recommendations",
                  aggregation: "Combine all chunk responses into comprehensive assessment less than 128K tokens",
              }
          };

      } catch (error) {
          console.error(`[GitHubApiService] Error in chunked repository analysis:`, error);
          throw error;
      }
  }

  /**
   * Filter files relevant for SDLC analysis
   */
  private filterRelevantFiles(files: any[], excludePatterns: string[]): any[] {
      return files.filter(file => {
          if (!file.content) return false;
          
          const path = file.path.toLowerCase();
          
          // Exclude patterns
          for (const pattern of excludePatterns) {
              if (path.includes(pattern.toLowerCase())) {
                  return false;
              }
          }
          
          // Include relevant file types for SDLC analysis
          const relevantExtensions = [
              '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.cs', '.go', '.rb', '.php', 
              '.cpp', '.c', '.h', '.json', '.yml', '.yaml', '.xml', '.sql', '.md', 
              '.txt', '.env', '.config', '.toml', '.ini', '.sh', '.bat', '.ps1', '.Dockerfile'
          ];
          
          return relevantExtensions.some(ext => path.endsWith(ext)) || 
                path.includes('dockerfile') || 
                path.includes('makefile') ||
                path.includes('readme') ||
                path.includes('license') ||
                path.includes('package.json') ||
                path.includes('docker-compose') ||
                path.includes('requirements.txt');
      });
  }

  /**
   * Create chunks optimized for LLM analysis
   */
  private createLLMOptimizedChunks(files: any[], maxTokensPerChunk: number): any[][] {
      const chunks: any[][] = [];
      const reserveTokens = 20000; // More reserve for LLM response
      const effectiveMaxTokens = maxTokensPerChunk - reserveTokens;
      
      console.log(`[GitHubApiService] Creating LLM-optimized chunks with ${effectiveMaxTokens} effective tokens`);
      
      // Sort by priority and group related files
      const prioritizedFiles = this.prioritizeForLLMAnalysis(files);
      
      let currentChunk: any[] = [];
      let currentChunkTokens = 0;

      for (const file of prioritizedFiles) {
          const fileTokens = this.estimateTokenCount(file.content) + 200; // Metadata overhead
          const priority = this.calculateFilePriority(file.path);
          
          // Skip oversized files
          if (fileTokens > effectiveMaxTokens) {
              console.warn(`[GitHubApiService] Skipping oversized file: ${file.path} (${fileTokens} tokens)`);
              continue;
          }
          
          // Start new chunk if this would exceed limit
          if (currentChunkTokens + fileTokens > effectiveMaxTokens && currentChunk.length > 0) {
              console.log(`[GitHubApiService] LLM chunk ${chunks.length + 1} completed: ${currentChunk.length} files, ~${currentChunkTokens} tokens`);
              chunks.push([...currentChunk]);
              currentChunk = [];
              currentChunkTokens = 0;
          }
          
          // Add file to current chunk
          currentChunk.push({
              ...file,
              estimatedTokens: fileTokens,
              priority: priority
          });
          currentChunkTokens += fileTokens;
      }
      
      // Add final chunk
      if (currentChunk.length > 0) {
          console.log(`[GitHubApiService] Final LLM chunk ${chunks.length + 1}: ${currentChunk.length} files, ~${currentChunkTokens} tokens`);
          chunks.push(currentChunk);
      }
      
      console.log(`[GitHubApiService] Created ${chunks.length} LLM-optimized chunks`);
      return chunks;
  }

  /**
   * Prioritize files for LLM analysis
   */
  private prioritizeForLLMAnalysis(files: any[]): any[] {
      return [...files].sort((a, b) => {
          const aPriority = this.calculateFilePriority(a.path);
          const bPriority = this.calculateFilePriority(b.path);
          
          if (aPriority !== bPriority) {
              return bPriority - aPriority; // Higher priority first
          }
          
          // Same priority, prefer smaller files
          const aTokens = this.estimateTokenCount(a.content || '');
          const bTokens = this.estimateTokenCount(b.content || '');
          return aTokens - bTokens;
      });
  }

  /**
   * Calculate file priority for LLM analysis
   */
  private calculateFilePriority(path: string): number {
      const lowerPath = path.toLowerCase();
      
      // Critical configuration files (highest priority)
      if (lowerPath.includes('package.json')) return 100;
      if (lowerPath.includes('dockerfile')) return 95;
      if (lowerPath.includes('docker-compose')) return 90;
      if (lowerPath.includes('tsconfig.json')) return 85;
      if (lowerPath.includes('.env') && !lowerPath.includes('example')) return 80;
      
      // Main application files
      if (lowerPath.includes('index.') || lowerPath.includes('main.')) return 75;
      if (lowerPath.includes('app.')) return 70;
      if (lowerPath.includes('server.')) return 65;
      if (lowerPath.includes('config.')) return 60;
      
      // Source code files
      if (lowerPath.endsWith('.ts') || lowerPath.endsWith('.tsx')) return 50;
      if (lowerPath.endsWith('.js') || lowerPath.endsWith('.jsx')) return 45;
      if (lowerPath.endsWith('.py')) return 45;
      if (lowerPath.endsWith('.java')) return 45;
      
      // Documentation and other files
      if (lowerPath.includes('readme')) return 25;
      if (lowerPath.endsWith('.md')) return 20;
      if (lowerPath.endsWith('.json')) return 15;
      
      return 10;
  }

  /**
   * Basic structure analysis (lightweight, no heavy processing)
   */
  private analyzeBasicStructure(files: any[]): any {
      const structure = {
          hasTests: false,
          hasDocumentation: false,
          hasConfigFiles: false,
          hasSecurityFiles: false,
          hasCICD: false,
          directories: new Set<string>()
      };
      
      files.forEach(file => {
          const path = file.path.toLowerCase();
          
          if (path.includes('test') || path.includes('spec')) structure.hasTests = true;
          if (path.includes('readme') || path.includes('doc')) structure.hasDocumentation = true;
          if (path.includes('config') || path.includes('.env')) structure.hasConfigFiles = true;
          if (path.includes('security') || path.includes('auth')) structure.hasSecurityFiles = true;
          if (path.includes('.github') || path.includes('ci') || path.includes('pipeline')) structure.hasCICD = true;
          
          const dir = path.split('/')[0];
          structure.directories.add(dir);
      });
      
      return {
          ...structure,
          directories: Array.from(structure.directories)
      };
  }
}