
import Redis from 'ioredis'; // Or a lightweight fetch utility
import { JiraApiService } from './jira-api';
import { REDIS_HOST, REDIS_PORT } from '../utils/config';
import { redisClient } from '../utils/redisClient.js';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const PROJECT_NAME = "GL FP&A";
export let PROJECT_KEY:string

export class JiraCacheService {
  private redis = redisClient;
  private jiraApi: JiraApiService; // For making the initial API calls
  private PFA_PROJECT_KEY = "PFA"; // Example: Focus on PFA project initially
  private PFA_BOARD_ID = "5892";    // Example: Board ID for PFA

  constructor(jiraApi: JiraApiService) {
    this.jiraApi = jiraApi;
  }

  async initializeCache(): Promise<void> {
    console.log("[JiraCacheService] Initializing Jira metadata cache...");
    const startTime = Date.now();
    try {
      const pfaProjectKey = this.PFA_PROJECT_KEY;
      const pfaBoardId = this.PFA_BOARD_ID;

      // Step 1: Cache foundational data that other methods might depend on.
      // cacheCustomFields is needed by cacheStoriesWithDetailsForBoard to get the sprint custom field ID.
      await this.cacheCustomFields();
      console.log("[JiraCacheService] Custom fields cached.");

      // Step 2: Cache other metadata in parallel.
      // These operations are largely independent of each other once custom fields are known.
      const metadataPromises = [
        this.cacheProjects().then(() => console.log("[JiraCacheService] Projects cached.")),
        this.cachePriorities().then(() => console.log("[JiraCacheService] Priorities cached.")),
        this.cacheLabels().then(() => console.log("[JiraCacheService] Labels cached.")),
        this.cacheIssueTypesForProject(pfaProjectKey).then(() => console.log(`[JiraCacheService] Issue types for ${pfaProjectKey} cached.`)),
        this.cacheAssignableUsersForProject(pfaProjectKey).then(() => console.log(`[JiraCacheService] Assignable users for ${pfaProjectKey} cached.`)),
        this.cacheSprintsForBoard(pfaBoardId).then(() => console.log(`[JiraCacheService] Sprints for board ${pfaBoardId} cached.`)),
        this.cacheParentIssuesForProject(pfaProjectKey).then(() => console.log(`[JiraCacheService] Parent issues for ${pfaProjectKey} cached.`))
      ];
      await Promise.all(metadataPromises);
      console.log("[JiraCacheService] Core metadata (projects, priorities, labels, issue types, users, sprints, parent issues) cached in parallel.");

      // Step 3: Cache the most expensive part (stories with details) last.
      // This depends on cacheCustomFields having run.
      // await this.cacheStoriesWithDetailsForBoard(pfaBoardId);
      // The console log for this is already inside cacheStoriesWithDetailsForBoard

      const endTime = Date.now();
      console.log(`[JiraCacheService] Jira metadata cache initialized successfully in ${(endTime - startTime) / 1000} seconds.`);
    } catch (error) {
      const endTime = Date.now();
      console.error(`[JiraCacheService] Failed to initialize Jira metadata cache after ${(endTime - startTime) / 1000} seconds:`, error);
      // Depending on your requirements, you might want to re-throw the error
      // to prevent the server from starting with an incomplete cache.
      // throw error; 
    }
  }

  private async cacheProjects() {
    console.log('Caching Jira projects...');
    const projects = await this.jiraApi.fetchJson<any[]>('/rest/api/3/project');
    if (projects) {
      const pipeline = this.redis.pipeline();
      projects.forEach(project => {
        if(project.name == PROJECT_NAME) {
            PROJECT_KEY = project.key; // Store the key of the project we are interested in
            pipeline.hset(`jira:project:${project.key}`, { id: project.id, key: project.key, name: project.name, description: project.description || '' });
            pipeline.sadd('jira:projects', project.key); // Store all project keys in a set for easy lookup
        }
      });
      await pipeline.exec();
      console.log(`Cached ${projects.length} projects.`);
    }
  }

  private async cacheIssueTypesForProject(projectKey: string) {
    // Using createmeta is often good for getting fields too
    console.log(`Caching issue types for project ${projectKey}...`);
    const meta = await this.jiraApi.fetchJson<any>(`/rest/api/3/issue/createmeta?projectKeys=${projectKey}&expand=projects.issuetypes`);
    if (meta && meta.projects && meta.projects.length > 0) {
      const projectMeta = meta.projects[0];
      const issueTypes = projectMeta.issuetypes;
      if (issueTypes) {
        const pipeline = this.redis.pipeline();
        issueTypes.forEach((it: any) => {
          pipeline.hset(`jira:project:${projectKey}:issuetype:${it.name.toLowerCase()}`, { id: it.id, name: it.name, description: it.description });
        });
        await pipeline.exec();
        console.log(`Cached ${issueTypes.length} issue types for project ${projectKey}.`);
      }
    }
  }


  private async cacheAssignableUsersForProject(projectKey: string) {
    console.log(`Caching assignable users for project ${projectKey}...`);
    const users = await this.jiraApi.fetchJson<any[]>(`/rest/api/3/user/assignable/search?project=${projectKey}`);
    if (users) {
      const pipeline = this.redis.pipeline();
      users.forEach(user => {
        if (user.accountId && user.displayName && user.emailAddress && user.active == true) {
          // Store by displayName for easier lookup, but be wary of non-unique display names
          pipeline.hset(`jira:project:${projectKey}:user:byname:${user.displayName.toLowerCase()}`, { accountId: user.accountId, emailAddress: user.emailAddress, displayName: user.displayName });
          pipeline.hset(`jira:user:byid:${user.accountId}`, { displayName: user.displayName, emailAddress: user.emailAddress || '', accountId: user.accountId });
        }
      });
      await pipeline.exec();
      console.log(`Cached ${users.length} assignable users for project ${projectKey}.`);
    }
  }

  private async cacheSprintsForBoard(boardId: string) {
    console.log(`Caching sprints for board ${boardId}...`);
    const sprintData = await this.jiraApi.fetchJson<any>(`/rest/agile/1.0/board/${boardId}/sprint?state=active,future,closed`); // Adjust maxResults
    if (sprintData && sprintData.values) {
      const pipeline = this.redis.pipeline();
      sprintData.values.forEach((sprint: any) => {
        pipeline.hset(`jira:board:${boardId}:sprint:byname:${sprint.name.toLowerCase()}`, { id: sprint.id, name: sprint.name, state: sprint.state, boardId: boardId });
        pipeline.hset(`jira:sprint:byid:${sprint.id}`, {id: sprint.id, name: sprint.name, state: sprint.state, boardId: boardId });
      });
      await pipeline.exec();
      console.log(`Cached ${sprintData.values.length} sprints for board ${boardId}.`);
    }
  }

  private async cachePriorities() {
    console.log('Caching Jira priorities...');
    const priorities = await this.jiraApi.fetchJson<any[]>('/rest/api/3/priority');
    if (priorities) {
        const pipeline = this.redis.pipeline();
        priorities.forEach(p => {
            pipeline.hset(`jira:priority:byname:${p.name.toLowerCase()}`, { id: p.id, name: p.name, description: p.description});
        });
        await pipeline.exec();
        console.log(`Cached ${priorities.length} priorities.`);
    }
  }

  private async cacheLabels() {
    const labelsData = await this.jiraApi.fetchJson<any>('/rest/api/3/label?maxResults=1000'); // Adjust maxResults
    if (labelsData && labelsData.values) {
        await this.redis.sadd('jira:labels', ...labelsData.values);
        console.log(`Cached ${labelsData.values.length} labels.`);
    }
  }

  private async cacheCustomFields() {
    const fields = await this.jiraApi.fetchJson<any[]>('/rest/api/3/field');
    if (fields) {
        const pipeline = this.redis.pipeline();
        fields.filter(f => f.custom).forEach(cf => { // Only custom fields
            pipeline.hset(`jira:customfield:byid:${cf.id}`, { id: cf.id, name: cf.name, key: cf.key, type: cf.schema?.type, customType: cf.schema?.custom });
            pipeline.hset(`jira:customfield:byname:${cf.name.toLowerCase()}`, { id: cf.id, name: cf.name, key: cf.key, type: cf.schema?.type, customType: cf.schema?.custom });

        });
        await pipeline.exec();
        console.log(`Cached custom fields details.`);
    }
  }

  private async cacheParentIssuesForProject(projectKey: string) {
    console.log(`[JiraCacheService.cacheParentIssuesForProject] Caching parent issues (Epics) for project ${projectKey}...`);
    try {
      const jql = `project = "${projectKey}" AND issuetype = Epic ORDER BY created DESC`;
      const epicData = await this.jiraApi.fetchJson<any>(
        `/rest/api/3/search?jql=${encodeURIComponent(jql)}&fields=summary,status,issuetype,created,updated,key,id&maxResults=100` // Fetch relevant fields
      );

      if (epicData && epicData.issues && epicData.issues.length > 0) {
        const pipeline = this.redis.pipeline();
        const parentIssueKeysSetKey = `jira:project:${projectKey}:parentissuekeys`;
        
        // Clear old keys in the set to ensure freshness, or use a different update strategy
        await this.redis.del(parentIssueKeysSetKey);

        epicData.issues.forEach((epic: any) => {
          const epicDetails = {
            id: epic.id,
            key: epic.key,
            summary: epic.fields.summary,
            status: epic.fields.status?.name, // Status might be complex, get name
            issueType: epic.fields.issuetype?.name,
            created: epic.fields.created,
            updated: epic.fields.updated,
          };
          pipeline.hset(`jira:project:${projectKey}:parentissue:bykey:${epic.key}`, epicDetails);
          pipeline.hset(`jira:project:${projectKey}:parentissue:byid:${epic.id}`, epicDetails);
          pipeline.sadd(parentIssueKeysSetKey, epic.key);
        });
        await pipeline.exec();
        console.log(`[JiraCacheService.cacheParentIssuesForProject] Cached ${epicData.issues.length} parent issues (Epics) for project ${projectKey}.`);
      } else {
        console.log(`[JiraCacheService.cacheParentIssuesForProject] No parent issues (Epics) found for project ${projectKey}.`);
      }
    } catch (error) {
      console.error(`[JiraCacheService.cacheParentIssuesForProject] Error caching parent issues for project ${projectKey}:`, error);
    }
  }

  /**
   * Caches a snapshot of stories for a specific sprint and board.
   * This is intended to be called after fetching stories live for the sprint metrics tool.
   */
  async cacheSprintStorySnapshot(sprintId: number, boardId: string, stories: any[]): Promise<void> {
    if (!stories || stories.length === 0) {
      console.log(`[JiraCacheService.cacheSprintStorySnapshot] No stories provided to cache for sprint ${sprintId} on board ${boardId}.`);
      return;
    }
    const sprintStoriesSnapshotKey = `jira:board:${boardId}:sprint:${sprintId}:stories_snapshot`;
    const storyDetailPipeline = this.redis.pipeline();
    const storyKeys: string[] = [];

    for (const story of stories) {
      if (story && story.key) {
        storyKeys.push(story.key);
        storyDetailPipeline.set(`jira:story:${story.key}:details_snapshot`, JSON.stringify(story));
      }
    }

    if (storyKeys.length > 0) {
      storyDetailPipeline.del(sprintStoriesSnapshotKey); // Clear previous snapshot
      storyDetailPipeline.sadd(sprintStoriesSnapshotKey, ...storyKeys);
      await storyDetailPipeline.exec();
      console.log(`[JiraCacheService.cacheSprintStorySnapshot] Cached snapshot of ${storyKeys.length} stories for sprint ${sprintId} on board ${boardId}.`);
    }
  }

  async cacheSprintMetricsData(sprintId: number, boardId: string, stories: any[]): Promise<void> {
    if (!stories || stories.length === 0) {
      console.log(`[JiraCacheService.cacheSprintMetricsData] No stories provided to cache for sprint ${sprintId} on board ${boardId}.`);
      return;
    }
    
    const metricsData = stories.map(story => ({
      key: story.key,
      summary: story.fields?.summary || '',
      status: story.fields?.status?.name || 'Unknown',
      statusCategory: story.fields?.status?.statusCategory?.name || 'Unknown',
      assignee: story.fields?.assignee?.displayName || 'Unassigned',
      issueType: story.fields?.issuetype?.name || 'Unknown',
      priority: story.fields?.priority?.name || 'Unknown',
      storyPoints: story.fields?.customfield_10058 || 0, // Adjust field ID
      created: story.fields?.created,
      updated: story.fields?.updated,
      resolutiondate: story.fields?.resolutiondate,
      labels: story.fields?.labels || [],
      components: story.fields?.components?.map((c: any) => c.name) || [],
      fixVersions: story.fields?.fixVersions?.map((v: any) => v.name) || []
    }));

    const sprintMetricsKey = `jira:board:${boardId}:sprint:${sprintId}:metrics_data`;
    await this.redis.set(sprintMetricsKey, JSON.stringify(metricsData), 'EX', 3600); // Cache for 1 hour
    console.log(`[JiraCacheService.cacheSprintMetricsData] Cached metrics data for ${metricsData.length} stories for sprint ${sprintId} on board ${boardId}.`);
  }

  // private async cacheStoriesWithDetailsForBoard(boardId: string) {
  //   console.log(`[JiraCacheService.cacheStoriesWithDetailsForBoard] Caching stories with details for board ${boardId}...`);
  //   try {
  //     let projectKeyForJQL = "";
  //     if (boardId === this.PFA_BOARD_ID) {
  //       projectKeyForJQL = this.PFA_PROJECT_KEY;
  //     } else {
  //       console.warn(`[JiraCacheService.cacheStoriesWithDetailsForBoard] Board ID ${boardId} does not match PFA_BOARD_ID. Project key for JQL might not be optimal.`);
  //       // Potentially try to derive projectKey from board configuration if needed for other boards
  //     }

  //     // Attempt to get active and closed sprints for the board to refine JQL
  //     const cachedSprintsOnBoard = await this.getCachedSprintsForBoard(boardId);
  //     const activeAndClosedSprints = cachedSprintsOnBoard.filter(
  //       sprint => sprint.state === 'active' || sprint.state === 'closed' // Changed from 'future' to 'closed'
  //     );

  //     let jql = "";
  //     if (activeAndClosedSprints.length > 0) {
  //       const sprintIds = activeAndClosedSprints.map(s => s.id);
  //       const projectClause = projectKeyForJQL ? `project = "${projectKeyForJQL}" AND ` : "";
  //       jql = `${projectClause}issuetype = Story AND sprint IN (${sprintIds.join(',')}) ORDER BY updated DESC`;
  //       console.log(`[JiraCacheService.cacheStoriesWithDetailsForBoard] Found ${activeAndClosedSprints.length} active/closed sprints. Using JQL: "${jql}"`);
  //     } else {
  //       // Fallback if no active/closed sprints: fetch most recently updated stories for the project
  //       const projectClause = projectKeyForJQL ? `project = "${projectKeyForJQL}" AND ` : "";
  //       jql = `${projectClause}issuetype = Story ORDER BY updated DESC`;
  //       console.warn(`[JiraCacheService.cacheStoriesWithDetailsForBoard] No active or closed sprints found for board ${boardId}. Falling back to JQL: "${jql}" (might be slow if many stories). Consider limiting this fallback.`);
  //     }

  //     const sprintCustomFieldId = await this.getCustomFieldIdByName("Sprint") || "customfield_10020";
      
  //     const fieldsToFetch = [
  //       "summary", "status", "assignee", "comment", "issuetype", "key", "id", 
  //       "created", "updated", "priority", "labels", 
  //       sprintCustomFieldId 
  //     ];

  //     if (!jql) {
  //         console.log(`[JiraCacheService.cacheStoriesWithDetailsForBoard] JQL is empty, skipping story fetching for board ${boardId}.`);
  //         return;
  //     }

  //     const detailedStories = await this.jiraApi.searchDetailedIssues(jql, fieldsToFetch);

  //     if (!detailedStories || detailedStories.length === 0) {
  //       console.log(`[JiraCacheService.cacheStoriesWithDetailsForBoard] No stories found with JQL: "${jql}".`);
  //       return;
  //     }

  //     const pipeline = this.redis.pipeline();
  //     let storiesCachedCount = 0;

  //     const assigneeIndexKeysPattern = `jira:board:${boardId}:user:*:stories`;
  //     const sprintIndexKeysPattern = `jira:board:${boardId}:sprint:*:stories`;
  //     const allBoardStoriesSetKey = `jira:board:${boardId}:allcachedstories`; // Key for the set of all story keys for this board

  //     const oldAssigneeKeys = await this.redis.keys(assigneeIndexKeysPattern);
  //     if (oldAssigneeKeys.length > 0) pipeline.del(...oldAssigneeKeys);
  //     const oldSprintKeys = await this.redis.keys(sprintIndexKeysPattern);
  //     if (oldSprintKeys.length > 0) pipeline.del(...oldSprintKeys);
  //     pipeline.del(allBoardStoriesSetKey); // Clear previous set of all stories for this board

  //     for (const issue of detailedStories) { 
  //       const storyKey = issue.key;
  //       if (!storyKey) {
  //         console.warn("[JiraCacheService.cacheStoriesWithDetailsForBoard] Found an issue without a key, skipping.", issue);
  //         continue;
  //       }

  //       const storyDetailKey = `jira:story:${storyKey}:details`;
  //       pipeline.set(storyDetailKey, JSON.stringify(issue)); 
  //       pipeline.sadd(allBoardStoriesSetKey, storyKey); // Add story key to the board's set of all stories

  //       if (issue.fields?.assignee && issue.fields.assignee.accountId) {
  //         const assigneeIndexKey = `jira:board:${boardId}:user:${issue.fields.assignee.accountId}:stories`;
  //         pipeline.sadd(assigneeIndexKey, storyKey);
  //       }

  //       const sprintFieldData = issue.fields?.[sprintCustomFieldId];
  //       if (sprintFieldData && Array.isArray(sprintFieldData)) {
  //         for (const sprintString of sprintFieldData) {
  //           if (typeof sprintString === 'string') {
  //             const idMatch = sprintString.match(/id=(\d+)/);
  //             const sprintBoardIdMatch = sprintString.match(/rapidViewId=(\d+)/);
              
  //             if (idMatch && idMatch[1]) {
  //               const sprintId = parseInt(idMatch[1], 10);
  //               let sprintBelongsToCurrentBoard = true; 

  //               if (sprintBoardIdMatch && sprintBoardIdMatch[1]) {
  //                 sprintBelongsToCurrentBoard = parseInt(sprintBoardIdMatch[1], 10) === parseInt(boardId, 10);
  //               }
                
  //               if (sprintId && sprintBelongsToCurrentBoard) {
  //                 const sprintIndexKey = `jira:board:${boardId}:sprint:${sprintId}:stories`;
  //                 pipeline.sadd(sprintIndexKey, storyKey);
  //               }
  //             }
  //           }
  //         }
  //       } else if (issue.fields?.sprint && typeof issue.fields.sprint === 'object' && issue.fields.sprint.id) {
  //           const sprintObject = issue.fields.sprint;
  //           if (sprintObject.boardId === undefined || sprintObject.boardId === parseInt(boardId,10)) {
  //                const sprintIndexKey = `jira:board:${boardId}:sprint:${sprintObject.id}:stories`;
  //                pipeline.sadd(sprintIndexKey, storyKey);
  //           }
  //       }
  //       storiesCachedCount++;
  //     }
  //     await pipeline.exec();
  //     console.log(`[JiraCacheService.cacheStoriesWithDetailsForBoard] Cached details for ${storiesCachedCount} stories from board ${boardId} using JQL "${jql}". Added ${storiesCachedCount} keys to ${allBoardStoriesSetKey}.`);

  //   } catch (error) {
  //     console.error(`[JiraCacheService.cacheStoriesWithDetailsForBoard] Error caching stories for board ${boardId}:`, error);
  //   }
  // }

  // --- Methods to retrieve data from cache ---
  generateSprintMetrics(stories: any[]): any {
    const totalStories = stories.length;
    const totalStoryPoints = stories.reduce((sum, story) => sum + (story.storyPoints || 0), 0);
    
    const statusCounts = stories.reduce((acc, story) => {
      acc[story.status] = (acc[story.status] || 0) + 1;
      return acc;
    }, {});

    const statusCategoryCounts = stories.reduce((acc, story) => {
      acc[story.statusCategory] = (acc[story.statusCategory] || 0) + 1;
      return acc;
    }, {});

    const issueTypeCounts = stories.reduce((acc, story) => {
      acc[story.issueType] = (acc[story.issueType] || 0) + 1;
      return acc;
    }, {});

    const assigneeCounts = stories.reduce((acc, story) => {
      acc[story.assignee] = (acc[story.assignee] || 0) + 1;
      return acc;
    }, {});

    const priorityCounts = stories.reduce((acc, story) => {
      acc[story.priority] = (acc[story.priority] || 0) + 1;
      return acc;
    }, {});

    const completedStories = stories.filter(story => 
      story.statusCategory === 'Done' || story.resolutiondate
    );
    const completedStoryPoints = completedStories.reduce((sum, story) => sum + (story.storyPoints || 0), 0);

    return {
      summary: {
        totalStories,
        totalStoryPoints,
        completedStories: completedStories.length,
        completedStoryPoints,
        completionRate: totalStories > 0 ? (completedStories.length / totalStories * 100).toFixed(1) : '0',
        pointsCompletionRate: totalStoryPoints > 0 ? (completedStoryPoints / totalStoryPoints * 100).toFixed(1) : '0'
      },
      breakdown: {
        byStatus: statusCounts,
        byStatusCategory: statusCategoryCounts,
        byIssueType: issueTypeCounts,
        byAssignee: assigneeCounts,
        byPriority: priorityCounts
      },
      stories: stories // Include lightweight story data for detailed analysis if needed
    };
  }
  
  async getSprintIdByName(sprintName: string, boardId: string): Promise<number | undefined> {
    const sprintDetails = await this.redis.hgetall(`jira:board:${boardId}:sprint:byname:${sprintName.toLowerCase()}`);
    return sprintDetails && sprintDetails.id ? parseInt(sprintDetails.id) : undefined;
  }

  async getUserAccountIdByName(userName: string, projectKey: string): Promise<string | undefined> {
    // This is a simplified lookup, real-world might need more sophisticated matching if names aren't unique
    const userDetails = await this.redis.hgetall(`jira:project:${projectKey}:user:byname:${userName.toLowerCase()}`);
    return userDetails && userDetails.accountId ? userDetails.accountId : undefined;
  }

  async getPriorityIdByName(priorityName: string): Promise<string | undefined> {
    const priorityDetails = await this.redis.hgetall(`jira:priority:byname:${priorityName.toLowerCase()}`);
    return priorityDetails && priorityDetails.id ? priorityDetails.id : undefined;
  }

  async getCustomFieldIdByName(fieldName: string): Promise<string | undefined> {
    const fieldDetails = await this.redis.hgetall(`jira:customfield:byname:${fieldName.toLowerCase()}`);
    return fieldDetails && fieldDetails.id ? fieldDetails.id : undefined;
  }
  
  async getAllCachedProjectDetails(): Promise<any[]> {
    const projectKeys = await this.redis.smembers('jira:projects');
    if (!projectKeys || projectKeys.length === 0) {
      return [];
    }
    const pipeline = this.redis.pipeline();
    projectKeys.forEach(key => pipeline.hgetall(`jira:project:${key}`));
    const results = await pipeline.exec();
    return results?.map(([err, data]) => data).filter(data => data) || [];
  }

  /**
   * Retrieves cached issue types for a specific project.
   * @param projectKey The key of the project (e.g., "PFA").
   */
  async getCachedIssueTypesForProject(projectKey: string): Promise<any[]> {
    const keysPattern = `jira:project:${projectKey}:issuetype:*`;
    const keys = await this.redis.keys(keysPattern);
    if (!keys || keys.length === 0) {
      return [];
    }
    const pipeline = this.redis.pipeline();
    keys.forEach(key => pipeline.hgetall(key));
    const results = await pipeline.exec();
    return results?.map(([err, data]) => data).filter(data => data) || [];
  }

  /**
   * Retrieves cached assignable users for a specific project.
   * @param projectKey The key of the project (e.g., "PFA").
   */
  async getCachedAssignableUsersForProject(projectKey: string): Promise<any[]> {
    // Retrieves users stored by name for the project
    const keysPattern = `jira:project:${projectKey}:user:byname:*`;
    const keys = await this.redis.keys(keysPattern);
    if (!keys || keys.length === 0) {
      return [];
    }
    const pipeline = this.redis.pipeline();
    keys.forEach(key => pipeline.hgetall(key));
    const results = await pipeline.exec();
    return results?.map(([err, data]) => data).filter(data => data) || [];
  }

  /**
   * Retrieves cached sprints for a specific board.
   * @param boardId The ID of the board (e.g., "5892").
   */
  async getCachedSprintsForBoard(boardId: string): Promise<any[]> {
    const keysPattern = `jira:board:${boardId}:sprint:byname:*`;
    const keys = await this.redis.keys(keysPattern);
    if (!keys || keys.length === 0) {
      return [];
    }
    const pipeline = this.redis.pipeline();
    keys.forEach(key => pipeline.hgetall(key));
    const results = await pipeline.exec();
    return results?.map(([err, data]) => data).filter(data => data) || [];
  }

  /**
   * Retrieves all cached priorities.
   */
  async getAllCachedPriorities(): Promise<any[]> {
    const keysPattern = `jira:priority:byname:*`;
    const keys = await this.redis.keys(keysPattern);
    if (!keys || keys.length === 0) {
      return [];
    }
    const pipeline = this.redis.pipeline();
    keys.forEach(key => pipeline.hgetall(key));
    const results = await pipeline.exec();
    return results?.map(([err, data]) => data).filter(data => data) || [];
  }

  /**
   * Retrieves all cached labels.
   */
  async getAllCachedLabels(): Promise<string[]> {
    return this.redis.smembers('jira:labels');
  }

  /**
   * Retrieves all cached custom field details.
   */
  async getAllCachedCustomFields(): Promise<any[]> {
    // Fetch by name as it's more comprehensive in the current caching
    const keysPattern = `jira:customfield:byname:*`;
    const keys = await this.redis.keys(keysPattern);
    if (!keys || keys.length === 0) {
      return [];
    }
    const pipeline = this.redis.pipeline();
    keys.forEach(key => pipeline.hgetall(key));
    const results = await pipeline.exec();
    return results?.map(([err, data]) => data).filter(data => data) || [];
  }

  /**
   * Retrieves cached parent issues (e.g., Epics) for a specific project.
   * @param projectKey The key of the project (e.g., "PFA").
   */
  async getCachedParentIssuesForProject(projectKey: string): Promise<any[]> {
    console.log(`[JiraCacheService.getCachedParentIssuesForProject] Retrieving cached parent issues for project ${projectKey}...`);
    const parentIssueKeysKey = `jira:project:${projectKey}:parentissuekeys`;
    const parentIssueKeys = await this.redis.smembers(parentIssueKeysKey);

    if (!parentIssueKeys || parentIssueKeys.length === 0) {
      console.log(`[JiraCacheService.getCachedParentIssuesForProject] No parent issue keys found in set ${parentIssueKeysKey}.`);
      return [];
    }

    const pipeline = this.redis.pipeline();
    parentIssueKeys.forEach(key => {
      pipeline.hgetall(`jira:project:${projectKey}:parentissue:bykey:${key}`);
    });
    
    const results = await pipeline.exec();
    const parentIssues = results?.map(([err, data]) => {
      if (err) {
        console.error(`[JiraCacheService.getCachedParentIssuesForProject] Error fetching parent issue from pipeline:`, err);
        return null;
      }
      return data;
    }).filter(data => data) || [];
    
    console.log(`[JiraCacheService.getCachedParentIssuesForProject] Retrieved ${parentIssues.length} parent issues for project ${projectKey}.`);
    return parentIssues;
  }

  // async getCachedStoriesByAssignee(assigneeAccountId: string, boardId: string): Promise<any[]> {
  //   const assigneeIndexKey = `jira:board:${boardId}:user:${assigneeAccountId}:stories`;
  //   console.log(`[JiraCacheService.getCachedStoriesByAssignee] Fetching stories for user ${assigneeAccountId} on board ${boardId} using key ${assigneeIndexKey}`);
  //   const storyKeys = await this.redis.smembers(assigneeIndexKey);

  //   if (!storyKeys || storyKeys.length === 0) {
  //     console.log(`[JiraCacheService.getCachedStoriesByAssignee] No stories found for user ${assigneeAccountId} on board ${boardId}.`);
  //     return [];
  //   }

  //   const pipeline = this.redis.pipeline();
  //   storyKeys.forEach(key => pipeline.get(`jira:story:${key}:details`));
  //   const results = await pipeline.exec();

  //   return results?.map(([err, data]) => {
  //     if (err) {
  //       console.error("[JiraCacheService.getCachedStoriesByAssignee] Redis error fetching story detail:", err);
  //       return null;
  //     }
  //     return data ? JSON.parse(data as string) : null;
  //   }).filter(story => story !== null) || [];
  // }

  // async getCachedStoriesBySprintId(sprintId: number, boardId: string): Promise<any[]> {
  //   const sprintIndexKey = `jira:board:${boardId}:sprint:${sprintId}:stories`;
  //   console.log(`[JiraCacheService.getCachedStoriesBySprintId] Fetching stories for sprint ${sprintId} on board ${boardId} using key ${sprintIndexKey}`);
  //   const storyKeys = await this.redis.smembers(sprintIndexKey);

  //   if (!storyKeys || storyKeys.length === 0) {
  //     console.log(`[JiraCacheService.getCachedStoriesBySprintId] No stories found for sprint ${sprintId} on board ${boardId}.`);
  //     return [];
  //   }

  //   const pipeline = this.redis.pipeline();
  //   storyKeys.forEach(key => pipeline.get(`jira:story:${key}:details`));
  //   const results = await pipeline.exec();

  //   return results?.map(([err, data]) => {
  //     if (err) {
  //       console.error("[JiraCacheService.getCachedStoriesBySprintId] Redis error fetching story detail:", err);
  //       return null;
  //     }
  //     return data ? JSON.parse(data as string) : null;
  //   }).filter(story => story !== null) || [];
  // }

  // async getAllCachedStoriesForBoard(boardId: string): Promise<any[]> {
  //   const allBoardStoriesSetKey = `jira:board:${boardId}:allcachedstories`;
  //   console.log(`[JiraCacheService.getAllCachedStoriesForBoard] Fetching all stories for board ${boardId} using set key ${allBoardStoriesSetKey}`);
  //   const storyKeys = await this.redis.smembers(allBoardStoriesSetKey);

  //   if (!storyKeys || storyKeys.length === 0) {
  //     console.log(`[JiraCacheService.getAllCachedStoriesForBoard] No story keys found in set ${allBoardStoriesSetKey} for board ${boardId}.`);
  //     return [];
  //   }

  //   const pipeline = this.redis.pipeline();
  //   storyKeys.forEach(key => pipeline.get(`jira:story:${key}:details`));
  //   const results = await pipeline.exec();

  //   const stories = results?.map(([err, data]) => {
  //     if (err) {
  //       console.error("[JiraCacheService.getAllCachedStoriesForBoard] Redis error fetching story detail:", err);
  //       return null;
  //     }
  //     return data ? JSON.parse(data as string) : null;
  //   }).filter(story => story !== null) || [];
    
  //   console.log(`[JiraCacheService.getAllCachedStoriesForBoard] Retrieved ${stories.length} stories for board ${boardId}.`);
  //   return stories;
  // }

  /**
   * Retrieves a cached snapshot of stories for a specific sprint and board.
   */
  async getCachedSprintStorySnapshot(sprintId: number, boardId: string): Promise<any[] | null> {
    const sprintStoriesSnapshotKey = `jira:board:${boardId}:sprint:${sprintId}:stories_snapshot`;
    const storyKeys = await this.redis.smembers(sprintStoriesSnapshotKey);

    if (!storyKeys || storyKeys.length === 0) {
      console.log(`[JiraCacheService.getCachedSprintStorySnapshot] No story snapshot found for sprint ${sprintId} on board ${boardId}.`);
      return null;
    }

    const storyDetailPipeline = this.redis.pipeline();
    storyKeys.forEach(key => storyDetailPipeline.get(`jira:story:${key}:details_snapshot`));
    const results = await storyDetailPipeline.exec();

    const stories: any[] = [];
    results?.forEach(([err, data]) => {
      if (err) {
        console.error(`[JiraCacheService.getCachedSprintStorySnapshot] Redis error fetching story detail snapshot:`, err);
      } else if (data) {
        try {
          stories.push(JSON.parse(data as string));
        } catch (parseError) {
          console.error(`[JiraCacheService.getCachedSprintStorySnapshot] Error parsing story data for key:`, parseError);
        }
      }
    });

    if (stories.length > 0) {
      console.log(`[JiraCacheService.getCachedSprintStorySnapshot] Retrieved ${stories.length} stories from snapshot for sprint ${sprintId} on board ${boardId}.`);
      return stories;
    }
    return null;
  }

  async getCachedSprintMetricsData(sprintId: number, boardId: string): Promise<any[] | null> {
    const sprintMetricsKey = `jira:board:${boardId}:sprint:${sprintId}:metrics_data`;
    const cachedData = await this.redis.get(sprintMetricsKey);
    
    if (!cachedData) {
      console.log(`[JiraCacheService.getCachedSprintMetricsData] No metrics data found for sprint ${sprintId} on board ${boardId}.`);
      return null;
    }

    try {
      const metricsData = JSON.parse(cachedData);
      console.log(`[JiraCacheService.getCachedSprintMetricsData] Retrieved metrics data for ${metricsData.length} stories for sprint ${sprintId} on board ${boardId}.`);
      return metricsData;
    } catch (error) {
      console.error(`[JiraCacheService.getCachedSprintMetricsData] Error parsing metrics data:`, error);
      return null;
    }
  }
}