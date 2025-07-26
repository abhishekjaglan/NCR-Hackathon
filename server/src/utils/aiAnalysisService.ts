import { GitHubApiJiraService } from "../services/github-api";

export class AIAnalysisService {
  /**
   * Generates an AI-powered analysis of story comments and details including GitHub integration
   */
  static async generateStoryAnalysis(storyData: any, githubService?: GitHubApiJiraService): Promise<any> {
    const comments = storyData.comments || [];
    const commentTexts = comments.map((c: any) => `${c.author?.displayName || 'Unknown'}: ${c.body || ''}`);
    
    // Base analysis
    const baseAnalysis = {
      storyOverview: {
        key: storyData.key,
        summary: storyData.summary,
        status: storyData.status?.name,
        assignee: storyData.assignee?.displayName,
        priority: storyData.priority?.name,
        issueType: storyData.issueType?.name,
        created: storyData.created,
        updated: storyData.updated
      },
      commentAnalysis: {
        totalComments: comments.length,
        commentSummary: this.extractCommentInsights(commentTexts),
        keyDiscussionPoints: this.extractKeyPoints(commentTexts),
        concerns: this.extractConcerns(commentTexts),
        decisions: this.extractDecisions(commentTexts),
        actionItems: this.extractActionItems(commentTexts)
      },
      storyInsights: {
        description: storyData.description || 'No description provided',
        acceptanceCriteria: this.extractAcceptanceCriteria(storyData),
        linkedIssues: storyData.relatedIssues || [],
        attachments: storyData.attachments?.length || 0
      }
    };

    // Add GitHub integration if service is provided
    if (githubService && storyData.key) {
      console.log(`[AIAnalysisService] Fetching GitHub data for issue: ${storyData.key}`);
      
      try {
        const [commits, pullRequests, githubIssues] = await Promise.all([
          githubService.searchCommitsByIssueKey(storyData.key),
          githubService.searchPullRequestsByIssueKey(storyData.key),
          githubService.searchIssuesByIssueKey(storyData.key)
        ]);

        // Extract repository names from GitHub activity
        const repositories = new Set<string>();
        [...commits, ...pullRequests, ...githubIssues].forEach(item => {
          if (item.repository) repositories.add(item.repository);
        });

        const githubAnalysis = {
          github: {
            summary: {
              totalCommits: commits.length,
              totalPullRequests: pullRequests.length,
              totalGithubIssues: githubIssues.length,
              linkedRepositories: Array.from(repositories)
            },
            commits: commits.map(commit => ({
              sha: commit.sha.substring(0, 8),
              message: commit.message.split('\n')[0], // First line only
              author: commit.author,
              date: commit.date,
              repository: commit.repository,
              url: commit.url
            })),
            pullRequests: pullRequests.map(pr => ({
              number: pr.number,
              title: pr.title,
              state: pr.state,
              author: pr.author,
              repository: pr.repository,
              url: pr.url,
              labels: pr.labels,
              merged: !!pr.merged_at
            })),
            issues: githubIssues.map(issue => ({
              number: issue.number,
              title: issue.title,
              state: issue.state,
              author: issue.author,
              repository: issue.repository,
              url: issue.url,
              labels: issue.labels
            })),
            developmentActivity: {
              hasCommits: commits.length > 0,
              hasPullRequests: pullRequests.length > 0,
              hasGithubIssues: githubIssues.length > 0,
              lastCommitDate: commits.length > 0 ? commits[0].date : null,
              lastPRUpdate: pullRequests.length > 0 ? pullRequests[0].updated_at : null
            }
          }
        };

        // Enhanced AI prompt data with GitHub context
        const enhancedAiPromptData = {
          aiPromptData: {
            contextForAI: `
JIRA Story: ${storyData.key} - ${storyData.summary}
Status: ${storyData.status?.name}
Comments (${comments.length}): ${commentTexts.join(' | ')}
Description: ${storyData.description || 'None'}

GitHub Activity:
- Commits: ${commits.length} (Last: ${commits.length > 0 ? commits[0].date : 'None'})
- Pull Requests: ${pullRequests.length} (${pullRequests.filter(pr => pr.state === 'open').length} open, ${pullRequests.filter(pr => pr.merged_at).length} merged)
- GitHub Issues: ${githubIssues.length} (${githubIssues.filter(issue => issue.state === 'open').length} open)
- Repositories: ${Array.from(repositories).join(', ') || 'None'}

Development Progress: ${this.assessDevelopmentProgress(commits, pullRequests, githubIssues)}
            `.trim()
          }
        };

        return { ...baseAnalysis, ...githubAnalysis, ...enhancedAiPromptData };
      } catch (error) {
        console.error(`[AIAnalysisService] Error fetching GitHub data for ${storyData.key}:`, error);
        // Return base analysis if GitHub integration fails
        return {
          ...baseAnalysis,
          github: {
            error: "Failed to fetch GitHub data",
            summary: {
              totalCommits: 0,
              totalPullRequests: 0,
              totalGithubIssues: 0,
              linkedRepositories: []
            }
          },
          aiPromptData: {
            contextForAI: `
JIRA Story: ${storyData.key} - ${storyData.summary}
Status: ${storyData.status?.name}
Comments (${comments.length}): ${commentTexts.join(' | ')}
Description: ${storyData.description || 'None'}
GitHub Integration: Error fetching data
            `.trim()
          }
        };
      }
    }

    // Return base analysis without GitHub data
    return {
      ...baseAnalysis,
      aiPromptData: {
        contextForAI: `
JIRA Story: ${storyData.key} - ${storyData.summary}
Status: ${storyData.status?.name}
Comments (${comments.length}): ${commentTexts.join(' | ')}
Description: ${storyData.description || 'None'}
        `.trim()
      }
    };
  }

  private static assessDevelopmentProgress(commits: any[], pullRequests: any[], githubIssues: any[]): string {
    if (commits.length === 0 && pullRequests.length === 0) {
      return "No development activity detected";
    }
    
    const openPRs = pullRequests.filter(pr => pr.state === 'open').length;
    const mergedPRs = pullRequests.filter(pr => pr.merged_at).length;
    
    if (mergedPRs > 0) {
      return "Code has been merged to main branch";
    } else if (openPRs > 0) {
      return "Development in progress - PRs pending review";
    } else if (commits.length > 0) {
      return "Development started - commits made";
    } else {
      return "Planning phase - GitHub issues created";
    }
  }

  // ... existing private methods remain the same
  private static extractCommentInsights(commentTexts: string[]): string[] {
    const insights: string[] = [];
    const keywordPatterns = [
      /blocked|blocker|impediment/i,
      /completed|done|finished/i,
      /issue|problem|bug/i,
      /review|feedback/i,
      /testing|qa/i,
      /deployment|release/i
    ];

    commentTexts.forEach(comment => {
      keywordPatterns.forEach(pattern => {
        if (pattern.test(comment)) {
          insights.push(comment.substring(0, 200) + '...');
        }
      });
    });

    return [...new Set(insights)].slice(0, 5);
  }

  private static extractKeyPoints(commentTexts: string[]): string[] {
    return commentTexts
      .filter(comment => comment.length > 50)
      .map(comment => comment.substring(0, 150) + '...')
      .slice(0, 3);
  }

  private static extractConcerns(commentTexts: string[]): string[] {
    const concernKeywords = /concern|issue|problem|risk|blocker|delay/i;
    return commentTexts
      .filter(comment => concernKeywords.test(comment))
      .map(comment => comment.substring(0, 150) + '...')
      .slice(0, 3);
  }

  private static extractDecisions(commentTexts: string[]): string[] {
    const decisionKeywords = /decided|agreed|will|going to|plan to/i;
    return commentTexts
      .filter(comment => decisionKeywords.test(comment))
      .map(comment => comment.substring(0, 150) + '...')
      .slice(0, 3);
  }

  private static extractActionItems(commentTexts: string[]): string[] {
    const actionKeywords = /todo|action|need to|should|must|will do/i;
    return commentTexts
      .filter(comment => actionKeywords.test(comment))
      .map(comment => comment.substring(0, 150) + '...')
      .slice(0, 3);
  }

  private static extractAcceptanceCriteria(storyData: any): string {
    return storyData.acceptanceCriteria || 
           storyData.customfield_10085 || 
           'No acceptance criteria found';
  }
}