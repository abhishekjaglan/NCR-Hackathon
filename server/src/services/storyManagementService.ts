import { JiraApiService } from "./jira-api.js";
import { JiraCacheService } from "./jiraCacheService.js";
import { redisClient } from "../utils/redisClient.js";

export class StoryManagementService {
  private jiraApi: JiraApiService;
  private cacheService: JiraCacheService;
  private redis = redisClient;

  constructor(jiraApi: JiraApiService, cacheService: JiraCacheService) {
    this.jiraApi = jiraApi;
    this.cacheService = cacheService;
  }

  /**
   * Get stories for a sprint by name with caching
   */
  async getStoriesForSprint(sprintName: string, boardId: string = "5892"): Promise<any> {
    const cacheKey = `stories:sprint:${sprintName}:board:${boardId}`;
    
    try {
      // Check cache first
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        console.log(`[StoryManagementService] Cache hit for sprint stories: ${sprintName}`);
        return JSON.parse(cached);
      }

      console.log(`[StoryManagementService] Cache miss for sprint: ${sprintName}, fetching live data`);

      // Resolve sprint ID
      let sprintId: number | undefined;
      const sprintNameLower = sprintName.toLowerCase();

      if (sprintNameLower === "active sprint" || sprintNameLower === "current sprint") {
        const allSprintsOnBoard = await this.cacheService.getCachedSprintsForBoard(boardId);
        const activeSprint = allSprintsOnBoard.find(s => s.state === 'active');
        if (activeSprint && activeSprint.id) {
          sprintId = parseInt(activeSprint.id, 10);
        } else {
          throw new Error(`No active sprint found for board ${boardId}`);
        }
      } else {
        sprintId = await this.cacheService.getSprintIdByName(sprintName, boardId);
      }

      if (!sprintId) {
        throw new Error(`Could not resolve sprint ID for name: "${sprintName}"`);
      }

      // Fetch stories for the sprint
      const projectKey = "PFA"; // Hardcoded for PFA board
      const jql = `project = "${projectKey}" AND sprint = ${sprintId} AND issuetype in (Story, Task, Bug, Sub-task) ORDER BY priority DESC, updated DESC`;
      
      const fieldsToFetch = [
        'key', 'summary', 'status', 'assignee', 'issuetype', 'priority', 
        'created', 'updated', 'resolutiondate', 'labels', 'components', 
        'fixVersions', 'customfield_10058', 'description', 'comment',
        'customfield_10020', 'parent', 'subtasks', 'attachment'
      ];

      const stories = await this.jiraApi.searchDetailedIssues(jql, fieldsToFetch);

      if (!stories || stories.length === 0) {
        const result = {
          sprint: {
            id: sprintId,
            name: sprintName,
            boardId
          },
          summary: {
            totalStories: 0,
            totalStoryPoints: 0,
            statusBreakdown: {},
            assigneeBreakdown: {}
          },
          stories: [],
          lastUpdated: new Date().toISOString()
        };

        // Cache empty result for 30 minutes
        await this.redis.set(cacheKey, JSON.stringify(result), 'EX', 1800);
        return result;
      }

      // Process and summarize stories
      const processedStories = stories.map(story => this.processStoryData(story));
      const summary = this.generateSprintSummary(processedStories);

      const result = {
        sprint: {
          id: sprintId,
          name: sprintName,
          boardId
        },
        summary,
        stories: processedStories,
        lastUpdated: new Date().toISOString()
      };

      // Cache for 2 hours
      await this.redis.set(cacheKey, JSON.stringify(result), 'EX', 7200);
      console.log(`[StoryManagementService] Cached ${stories.length} stories for sprint: ${sprintName}`);

      return result;
    } catch (error) {
      console.error(`[StoryManagementService] Error getting stories for sprint ${sprintName}:`, error);
      throw error;
    }
  }

  /**
   * Get stories for a user with optional sprint filtering
   */
  async getStoriesForUser(userName: string, sprintName?: string, boardId: string = "5892"): Promise<any> {
    const cacheKey = sprintName 
      ? `stories:user:${userName}:sprint:${sprintName}:board:${boardId}`
      : `stories:user:${userName}:board:${boardId}`;
    
    try {
      // Check cache first
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        console.log(`[StoryManagementService] Cache hit for user stories: ${userName}`);
        return JSON.parse(cached);
      }

      console.log(`[StoryManagementService] Cache miss for user: ${userName}, fetching live data`);

      // Resolve user account ID
      const userAccountId = await this.cacheService.getUserAccountIdByName(userName, "PFA");
      if (!userAccountId) {
        throw new Error(`Could not resolve user account ID for: ${userName}`);
      }

      let jql: string;
      let sprintId: number | undefined;

      if (sprintName) {
        // Get stories for user in specific sprint
        const sprintNameLower = sprintName.toLowerCase();

        if (sprintNameLower === "active sprint" || sprintNameLower === "current sprint") {
          const allSprintsOnBoard = await this.cacheService.getCachedSprintsForBoard(boardId);
          const activeSprint = allSprintsOnBoard.find(s => s.state === 'active');
          if (activeSprint && activeSprint.id) {
            sprintId = parseInt(activeSprint.id, 10);
          } else {
            throw new Error(`No active sprint found for board ${boardId}`);
          }
        } else {
          sprintId = await this.cacheService.getSprintIdByName(sprintName, boardId);
        }

        if (!sprintId) {
          throw new Error(`Could not resolve sprint ID for name: "${sprintName}"`);
        }

        jql = `project = "PFA" AND assignee = "${userAccountId}" AND sprint = ${sprintId} AND issuetype in (Story, Task, Bug, Sub-task) ORDER BY priority DESC, updated DESC`;
      } else {
        // Get all active stories for user
        jql = `project = "PFA" AND assignee = "${userAccountId}" AND status not in (Done, Resolved, Closed) AND issuetype in (Story, Task, Bug, Sub-task) ORDER BY priority DESC, updated DESC`;
      }

      const fieldsToFetch = [
        'key', 'summary', 'status', 'assignee', 'issuetype', 'priority', 
        'created', 'updated', 'resolutiondate', 'labels', 'components', 
        'fixVersions', 'customfield_10058', 'description', 'comment',
        'customfield_10020', 'parent', 'subtasks', 'attachment'
      ];

      const stories = await this.jiraApi.searchDetailedIssues(jql, fieldsToFetch);

      const processedStories = stories ? stories.map(story => this.processStoryData(story)) : [];
      const summary = this.generateUserStoriesSummary(processedStories, userName);

      const result = {
        user: {
          name: userName,
          accountId: userAccountId
        },
        sprint: sprintName ? {
          id: sprintId,
          name: sprintName,
          boardId
        } : null,
        summary,
        stories: processedStories,
        lastUpdated: new Date().toISOString()
      };

      // Cache for 1 hour
      await this.redis.set(cacheKey, JSON.stringify(result), 'EX', 3600);
      console.log(`[StoryManagementService] Cached ${processedStories.length} stories for user: ${userName}`);

      return result;
    } catch (error) {
      console.error(`[StoryManagementService] Error getting stories for user ${userName}:`, error);
      throw error;
    }
  }

  private processStoryData(story: any): any {
    return {
      key: story.key,
      summary: story.fields?.summary || '',
      description: story.fields?.description || '',
      status: {
        name: story.fields?.status?.name || 'Unknown',
        category: story.fields?.status?.statusCategory?.name || 'Unknown',
        color: story.fields?.status?.statusCategory?.colorName || 'medium-gray'
      },
      assignee: {
        name: story.fields?.assignee?.displayName || 'Unassigned',
        accountId: story.fields?.assignee?.accountId,
        email: story.fields?.assignee?.emailAddress
      },
      issueType: {
        name: story.fields?.issuetype?.name || 'Unknown',
        iconUrl: story.fields?.issuetype?.iconUrl
      },
      priority: {
        name: story.fields?.priority?.name || 'Unknown',
        iconUrl: story.fields?.priority?.iconUrl
      },
      storyPoints: story.fields?.customfield_10058 || 0,
      dates: {
        created: story.fields?.created,
        updated: story.fields?.updated,
        resolved: story.fields?.resolutiondate
      },
      labels: story.fields?.labels || [],
      components: story.fields?.components?.map((c: any) => c.name) || [],
      fixVersions: story.fields?.fixVersions?.map((v: any) => v.name) || [],
      parent: story.fields?.parent ? {
        key: story.fields.parent.key,
        summary: story.fields.parent.fields?.summary
      } : null,
      subtasks: story.fields?.subtasks?.map((subtask: any) => ({
        key: subtask.key,
        summary: subtask.fields?.summary,
        status: subtask.fields?.status?.name
      })) || [],
      attachments: story.fields?.attachment?.length || 0,
      comments: story.fields?.comment?.total || 0,
      sprints: this.extractSprintInfo(story.fields?.customfield_10020),
      url: `${process.env.JIRA_BASE_URL}/browse/${story.key}`
    };
  }

  private extractSprintInfo(sprintField: any): any[] {
    if (!sprintField || !Array.isArray(sprintField)) return [];
    
    return sprintField.map(sprintString => {
      if (typeof sprintString === 'string') {
        const nameMatch = sprintString.match(/name=([^,]+)/);
        const idMatch = sprintString.match(/id=(\d+)/);
        const stateMatch = sprintString.match(/state=([^,]+)/);
        
        return {
          id: idMatch ? parseInt(idMatch[1]) : null,
          name: nameMatch ? nameMatch[1] : 'Unknown',
          state: stateMatch ? stateMatch[1] : 'Unknown'
        };
      }
      return null;
    }).filter(sprint => sprint !== null);
  }

  private generateSprintSummary(stories: any[]): any {
    const totalStories = stories.length;
    const totalStoryPoints = stories.reduce((sum, story) => sum + (story.storyPoints || 0), 0);
    
    const statusBreakdown = stories.reduce((acc, story) => {
      const status = story.status.name;
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});

    const statusCategoryBreakdown = stories.reduce((acc, story) => {
      const category = story.status.category;
      acc[category] = (acc[category] || 0) + 1;
      return acc;
    }, {});

    const assigneeBreakdown = stories.reduce((acc, story) => {
      const assignee = story.assignee.name;
      acc[assignee] = (acc[assignee] || 0) + 1;
      return acc;
    }, {});

    const priorityBreakdown = stories.reduce((acc, story) => {
      const priority = story.priority.name;
      acc[priority] = (acc[priority] || 0) + 1;
      return acc;
    }, {});

    const completedStories = stories.filter(story => 
      story.status.category === 'Done' || story.dates.resolved
    );
    const completedStoryPoints = completedStories.reduce((sum, story) => sum + (story.storyPoints || 0), 0);

    return {
      totalStories,
      totalStoryPoints,
      completedStories: completedStories.length,
      completedStoryPoints,
      completionRate: totalStories > 0 ? ((completedStories.length / totalStories) * 100).toFixed(1) : '0',
      pointsCompletionRate: totalStoryPoints > 0 ? ((completedStoryPoints / totalStoryPoints) * 100).toFixed(1) : '0',
      breakdown: {
        byStatus: statusBreakdown,
        byStatusCategory: statusCategoryBreakdown,
        byAssignee: assigneeBreakdown,
        byPriority: priorityBreakdown
      }
    };
  }

  private generateUserStoriesSummary(stories: any[], userName: string): any {
    const summary = this.generateSprintSummary(stories);
    
    return {
      ...summary,
      user: userName,
      workload: {
        totalAssigned: stories.length,
        inProgress: stories.filter(s => s.status.category === 'In Progress').length,
        toDo: stories.filter(s => s.status.category === 'To Do').length,
        done: stories.filter(s => s.status.category === 'Done').length,
        avgStoryPoints: stories.length > 0 ? 
          (stories.reduce((sum, s) => sum + (s.storyPoints || 0), 0) / stories.length).toFixed(1) : '0'
      }
    };
  }
}