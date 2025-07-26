import { GITHUB_TOKEN, GITHUB_BASE_URL, GITHUB_ORG } from "../utils/config.js";
import { redisClient } from "../utils/redisClient.js";

export class GitHubApiJiraService {
  private baseUrl: string;
  private headers: Record<string, string>;
  private org: string;
  private token: string;
  private redis = redisClient;

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

  /**
   * Get comprehensive GitHub information for a JIRA issue key with caching
   */
  async getGitHubInfoForIssue(issueKey: string): Promise<any> {
    const cacheKey = `github:issue:${issueKey}:comprehensive`;
    
    try {
      // Check cache first
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        console.log(`[GitHubApiService] Cache hit for GitHub info: ${issueKey}`);
        return JSON.parse(cached);
      }

      console.log(`[GitHubApiService] Cache miss for GitHub info: ${issueKey}, fetching live data`);

      // Fetch all GitHub data in parallel
      const [commits, pullRequests, issues, branches] = await Promise.all([
        this.searchCommitsByIssueKey(issueKey),
        this.searchPullRequestsByIssueKey(issueKey),
        this.searchIssuesByIssueKey(issueKey),
        this.searchBranchesByIssueKey(issueKey)
      ]);

      // Extract unique repositories
      const repositories = new Set<string>();
      [...commits, ...pullRequests, ...issues, ...branches].forEach(item => {
        if (item.repository) repositories.add(item.repository);
      });

      // Get repository details
      const repoDetails = await Promise.all(
        Array.from(repositories).map(async (repo) => {
          const repoName = repo.split('/')[1];
          return await this.getRepositoryInfo(repoName);
        })
      );

      const githubInfo = {
        issueKey,
        summary: {
          totalCommits: commits.length,
          totalPullRequests: pullRequests.length,
          totalIssues: issues.length,
          totalBranches: branches.length,
          linkedRepositories: Array.from(repositories),
          lastActivity: this.getLastActivity(commits, pullRequests, issues)
        },
        commits: commits.slice(0, 20), // Limit to 20 most recent
        pullRequests: pullRequests.slice(0, 15),
        issues: issues.slice(0, 10),
        branches: branches.slice(0, 10),
        repositories: repoDetails.filter(repo => repo !== null),
        developmentStatus: this.assessDevelopmentStatus(commits, pullRequests, issues),
        lastUpdated: new Date().toISOString()
      };

      // Cache for 1 hour
      await this.redis.set(cacheKey, JSON.stringify(githubInfo), 'EX', 3600);
      console.log(`[GitHubApiService] Cached GitHub info for ${issueKey}`);

      return githubInfo;
    } catch (error) {
      console.error(`[GitHubApiService] Error getting GitHub info for ${issueKey}:`, error);
      return {
        issueKey,
        error: 'Failed to fetch GitHub information',
        summary: {
          totalCommits: 0,
          totalPullRequests: 0,
          totalIssues: 0,
          totalBranches: 0,
          linkedRepositories: [],
          lastActivity: null
        }
      };
    }
  }

  /**
   * Search for commits mentioning the JIRA issue key
   */
  async searchCommitsByIssueKey(issueKey: string): Promise<any[]> {
    try {
      const query = `${issueKey} org:${this.org}`;
      console.log(`[GitHubApiService] Searching commits with query: ${query}`);
      
      const commits = await this.fetchJson(`/search/commits?q=${encodeURIComponent(query)}&sort=committer-date&order=desc&per_page=50`);
      
      if (commits?.items) {
        console.log(`[GitHubApiService] Found ${commits.items.length} commits for ${issueKey}`);
        return commits.items.map((commit: any) => ({
          sha: commit.sha,
          shortSha: commit.sha.substring(0, 8),
          message: commit.commit.message,
          author: commit.commit.author.name,
          authorEmail: commit.commit.author.email,
          date: commit.commit.author.date,
          url: commit.html_url,
          repository: commit.repository?.full_name || 'Unknown',
          verified: commit.commit.verification?.verified || false
        }));
      }
      console.log(`[GitHubApiService] No commits found for ${issueKey}`);
      return [];
    } catch (error) {
      console.error(`[GitHubApiService] Error searching commits for ${issueKey}:`, error);
      return [];
    }
  }

  /**
   * Search for pull requests mentioning the JIRA issue key
   */
  async searchPullRequestsByIssueKey(issueKey: string): Promise<any[]> {
    try {
      const query = `${issueKey} org:${this.org} is:pr`;
      console.log(`[GitHubApiService] Searching PRs with query: ${query}`);
      
      const prs = await this.fetchJson(`/search/issues?q=${encodeURIComponent(query)}&sort=updated&order=desc&per_page=30`);
      
      if (prs?.items) {
        console.log(`[GitHubApiService] Found ${prs.items.length} PRs for ${issueKey}`);
        return prs.items.map((pr: any) => ({
          number: pr.number,
          title: pr.title,
          state: pr.state,
          author: pr.user?.login,
          created_at: pr.created_at,
          updated_at: pr.updated_at,
          merged_at: pr.pull_request?.merged_at,
          closed_at: pr.closed_at,
          url: pr.html_url,
          repository: pr.repository_url?.split('/').slice(-2).join('/') || 'Unknown',
          labels: pr.labels?.map((label: any) => label.name) || [],
          assignees: pr.assignees?.map((assignee: any) => assignee.login) || [],
          reviewers: pr.requested_reviewers?.map((reviewer: any) => reviewer.login) || [],
          draft: pr.draft || false,
          mergeable: pr.mergeable,
          additions: pr.additions,
          deletions: pr.deletions,
          changed_files: pr.changed_files
        }));
      }
      console.log(`[GitHubApiService] No PRs found for ${issueKey}`);
      return [];
    } catch (error) {
      console.error(`[GitHubApiService] Error searching PRs for ${issueKey}:`, error);
      return [];
    }
  }

  /**
   * Search for GitHub issues mentioning the JIRA issue key
   */
  async searchIssuesByIssueKey(issueKey: string): Promise<any[]> {
    try {
      const query = `${issueKey} org:${this.org} is:issue`;
      console.log(`[GitHubApiService] Searching issues with query: ${query}`);
      
      const issues = await this.fetchJson(`/search/issues?q=${encodeURIComponent(query)}&sort=updated&order=desc&per_page=20`);
      
      if (issues?.items) {
        console.log(`[GitHubApiService] Found ${issues.items.length} issues for ${issueKey}`);
        return issues.items.map((issue: any) => ({
          number: issue.number,
          title: issue.title,
          state: issue.state,
          author: issue.user?.login,
          created_at: issue.created_at,
          updated_at: issue.updated_at,
          closed_at: issue.closed_at,
          url: issue.html_url,
          repository: issue.repository_url?.split('/').slice(-2).join('/') || 'Unknown',
          labels: issue.labels?.map((label: any) => label.name) || [],
          assignees: issue.assignees?.map((assignee: any) => assignee.login) || [],
          milestone: issue.milestone?.title,
          comments: issue.comments,
          body: issue.body?.substring(0, 500) // Truncate body
        }));
      }
      console.log(`[GitHubApiService] No issues found for ${issueKey}`);
      return [];
    } catch (error) {
      console.error(`[GitHubApiService] Error searching issues for ${issueKey}:`, error);
      return [];
    }
  }

  /**
   * Search for branches across repositories that might contain the issue key
   */
  async searchBranchesByIssueKey(issueKey: string): Promise<any[]> {
    try {
      // Search for branches across repositories that might contain the issue key
      const repositories = await this.getOrgRepositories();
      const branches: any[] = [];

      for (const repo of repositories.slice(0, 10)) { // Limit to first 10 repos
        try {
          const repoBranches = await this.fetchJson(`/repos/${this.org}/${repo.name}/branches`);
          if (repoBranches) {
            const matchingBranches = repoBranches
              .filter((branch: any) => branch.name.toLowerCase().includes(issueKey.toLowerCase()))
              .slice(0, 5)
              .map((branch: any) => ({
                name: branch.name,
                sha: branch.commit.sha,
                url: `https://github.com/${this.org}/${repo.name}/tree/${branch.name}`,
                repository: `${this.org}/${repo.name}`,
                protected: branch.protected || false
              }));
            
            branches.push(...matchingBranches);
          }
        } catch (error) {
          // Continue with other repositories if one fails
          console.warn(`[GitHubApiService] Failed to fetch branches for repo ${repo.name}:`, error);
        }
      }

      return branches;
    } catch (error) {
      console.error(`[GitHubApiService] Error searching branches for ${issueKey}:`, error);
      return [];
    }
  }

  private async getOrgRepositories(): Promise<any[]> {
    try {
      const repos = await this.fetchJson(`/orgs/${this.org}/repos?type=all&sort=updated&per_page=50`);
      return repos || [];
    } catch (error) {
      console.error(`[GitHubApiService] Error fetching org repositories:`, error);
      return [];
    }
  }

  private async getRepositoryInfo(repoName: string): Promise<any> {
    try {
      const repo = await this.fetchJson(`/repos/${this.org}/${repoName}`);
      if (repo) {
        return {
          name: repo.name,
          full_name: repo.full_name,
          description: repo.description,
          language: repo.language,
          stars: repo.stargazers_count,
          forks: repo.forks_count,
          open_issues: repo.open_issues_count,
          default_branch: repo.default_branch,
          url: repo.html_url,
          private: repo.private,
          archived: repo.archived,
          last_updated: repo.updated_at,
          size: repo.size,
          topics: repo.topics || []
        };
      }
      return null;
    } catch (error) {
      console.error(`[GitHubApiService] Error fetching repo info for ${repoName}:`, error);
      return null;
    }
  }

  private getLastActivity(commits: any[], pullRequests: any[], issues: any[]): string | null {
    const allDates = [
      ...commits.map(c => c.date),
      ...pullRequests.map(pr => pr.updated_at),
      ...issues.map(i => i.updated_at)
    ].filter(date => date);

    if (allDates.length === 0) return null;

    return allDates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
  }

  private assessDevelopmentStatus(commits: any[], pullRequests: any[], issues: any[]): string {
    const openPRs = pullRequests.filter(pr => pr.state === 'open').length;
    const mergedPRs = pullRequests.filter(pr => pr.merged_at).length;
    const openIssues = issues.filter(issue => issue.state === 'open').length;

    if (mergedPRs > 0) {
      return 'Code merged - development completed';
    } else if (openPRs > 0) {
      return 'Development in progress - PRs under review';
    } else if (commits.length > 0) {
      return 'Development started - commits made';
    } else if (openIssues > 0) {
      return 'Planning phase - issues created';
    } else {
      return 'No development activity detected';
    }
  }
}