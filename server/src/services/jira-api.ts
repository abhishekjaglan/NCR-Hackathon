import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import {
  AddCommentResponse,
  AdfDoc,
  CleanComment,
  CleanJiraIssue,
  JiraCommentResponse,
  SearchIssuesResponse,
} from "../types/jira.js";
import { JiraCacheService } from "./jiraCacheService";
import { logger } from "../utils/logger";

export class JiraApiService {
  protected baseUrl: string;
  protected headers: Headers;
  private readonly DEFAULT_BOARD_ID_FOR_SPRINT_RESOLUTION = "5892";
  private cacheService!: JiraCacheService

  constructor(baseUrl: string, email: string, apiToken: string) {
    this.baseUrl = baseUrl;
    const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");
    this.headers = new Headers({
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    });
    logger.info(`[JiraApiService] Initialized with email: ${email}, Token ending with: ${apiToken.slice(-10)}`);
    logger.debug(`[JiraApiService] Authorization header set to: Basic ${auth.substring(0, 10)}...${auth.slice(-10)}`);
  }

  public setCacheService(cacheService: JiraCacheService): void {
    this.cacheService = cacheService;
  }

  protected async handleFetchError(
    response: Response,
    url?: string,
    obj?: any
  ): Promise<never> {
    if (!response.ok) {
      let message = response.statusText;
      let errorData = {};
      try {
        errorData = await response.json();

        if (
          Array.isArray((errorData as any).errorMessages) &&
          (errorData as any).errorMessages.length > 0
        ) {
          message = (errorData as any).errorMessages.join("; ");
        } else if ((errorData as any).message) {
          message = (errorData as any).message;
        } else if ((errorData as any).errorMessage) {
          message = (errorData as any).errorMessage;
        }
      } catch (e) {
        logger.warn("Could not parse JIRA error response body as JSON.");
      }

      const details = JSON.stringify(errorData, null, 2);
      logger.error("JIRA API Error Details:", details);
      if (obj) {
        logger.info(typeof(obj), obj);
        logger.error(`[JiraApiService.handleFetchError] Associated object for ${url}:`, typeof obj, obj);
      }

      const errorMessage = message ? `: ${message}` : "";
      throw new Error(
        `JIRA API Error${errorMessage} (Status: ${response.status})`
      );
    }

    throw new Error("Unknown error occurred during fetch operation.");
  }

  private async findSprintIdByName(sprintName: string, boardId: string | number): Promise<number | undefined> {
    const cachedSprintId = await this.cacheService.getSprintIdByName(sprintName, String(boardId));
    if (cachedSprintId !== undefined) {
      console.log(`Found sprint ID ${cachedSprintId} for name "${sprintName}" in cache.`);
      return cachedSprintId;
    }

    console.log(`Sprint name "${sprintName}" not in cache for board ${boardId}, fetching from API...`);
    // ... (existing API call logic) ...
    // After fetching from API and finding it, you might want to update the cache:
    // if (foundSprint) { await this.cacheService.updateSprintInCache(foundSprint, String(boardId)); return foundSprint.id; }
    // For now, the initial population handles it. A refresh strategy would be next.
    try {
      const sprintsResponse = await this.fetchJson<any>(
        `/rest/agile/1.0/board/${boardId}/sprint?state=active,future` // Consider caching closed ones too initially
      );

      if (sprintsResponse && Array.isArray(sprintsResponse.values)) {
        const foundSprint = sprintsResponse.values.find(
          (sprint: any) => sprint.name.toLowerCase() === sprintName.toLowerCase()
        );
        if (foundSprint) {
          // Optionally update cache here if fetched live
          return foundSprint.id as number;
        } else {
          console.warn(`Sprint with name "${sprintName}" not found on board ${boardId} via API.`);
        }
      }
    } catch (error) {
      console.error(`Error fetching sprints for board ${boardId} via API:`, error);
    }
    return undefined;
  }

  private async findUserAccountIdByName(userName: string, projectKey: string): Promise<string | undefined> {
    const cachedAccountId = await this.cacheService.getUserAccountIdByName(userName, projectKey);
    if (cachedAccountId) {
      console.log(`Found account ID ${cachedAccountId} for user "${userName}" in project "${projectKey}" from cache.`);
      return cachedAccountId;
    }
    
    console.log(`User "${userName}" not in cache for project ${projectKey}, fetching from API...`);
    try {
      const encodedName = encodeURIComponent(userName);
      const usersResponse = await this.fetchJson<any[]>(
        `/rest/api/3/user/assignable/search?project=${projectKey}&query=${encodedName}&maxResults=5` // Be specific
      );

      if (usersResponse && usersResponse.length > 0) {
        // Implement matching logic (e.g., exact displayName match)
        const foundUser = usersResponse.find(
          (user: any) => user.displayName?.toLowerCase() === userName.toLowerCase()
        );
        if (foundUser && foundUser.accountId) {
           // Optionally update cache here
          return foundUser.accountId;
        }
        // Handle multiple matches or no exact match if necessary
        console.warn(`Could not find exact match for user "${userName}" in project "${projectKey}" via API.`);
      }
    } catch (error) {
      console.error(`Error searching for user "${userName}" via API:`, error);
    }
    return undefined;
  }

  /**
   * Extracts issue mentions from Atlassian document content
   * Looks for nodes that were auto-converted to issue links
   */
  protected extractIssueMentions(
    content: any[],
    source: "description" | "comment",
    commentId?: string
  ): CleanJiraIssue["relatedIssues"] {
    const mentions: NonNullable<CleanJiraIssue["relatedIssues"]> = [];

    const processNode = (node: any) => {
      if (node.type === "inlineCard" && node.attrs?.url) {
        const match = node.attrs.url.match(/\/browse\/([A-Z]+-\d+)/);
        if (match) {
          mentions.push({
            key: match[1],
            type: "mention",
            source,
            commentId,
          });
        }
      }

      if (node.type === "text" && node.text) {
        const matches = node.text.match(/[A-Z]+-\d+/g) || [];
        matches.forEach((key: string) => {
          mentions.push({
            key,
            type: "mention",
            source,
            commentId,
          });
        });
      }

      if (node.content) {
        node.content.forEach(processNode);
      }
    };

    content.forEach(processNode);
    return [...new Map(mentions.map((m) => [m.key, m])).values()];
  }

  protected cleanComment(comment: {
    id: string;
    body?: {
      content?: any[];
    };
    author?: {
      displayName?: string;
    };
    created: string;
    updated: string;
  }): CleanComment {
    const body = comment.body?.content
      ? this.extractTextContent(comment.body.content)
      : "";
    const mentions = comment.body?.content
      ? this.extractIssueMentions(comment.body.content, "comment", comment.id)
      : [];

    return {
      id: comment.id,
      body,
      author: comment.author?.displayName,
      created: comment.created,
      updated: comment.updated,
      mentions: mentions,
    };
  }

  /**
   * Recursively extracts text content from Atlassian Document Format nodes
   */
  protected extractTextContent(content: any[]): string {
    if (!Array.isArray(content)) return "";

    return content
      .map((node) => {
        if (node.type === "text") {
          return node.text || "";
        }
        if (node.content) {
          return this.extractTextContent(node.content);
        }
        return "";
      })
      .join("");
  }

  protected cleanIssue(issue: any): CleanJiraIssue {
    const description = issue.fields?.description?.content
      ? this.extractTextContent(issue.fields.description.content)
      : "";

    const cleanedIssue: CleanJiraIssue = {
      id: issue.id,
      key: issue.key,
      summary: issue.fields?.summary,
      status: issue.fields?.status?.name,
      created: issue.fields?.created,
      updated: issue.fields?.updated,
      description,
      relatedIssues: [],
    };

    if (issue.fields?.description?.content) {
      const mentions = this.extractIssueMentions(
        issue.fields.description.content,
        "description"
      );
      if (mentions.length > 0) {
        cleanedIssue.relatedIssues = mentions;
      }
    }

    if (issue.fields?.issuelinks?.length > 0) {
      const links = issue.fields.issuelinks.map((link: any) => {
        const linkedIssue = link.inwardIssue || link.outwardIssue;
        const relationship = link.type.inward || link.type.outward;
        return {
          key: linkedIssue.key,
          summary: linkedIssue.fields?.summary,
          type: "link" as const,
          relationship,
          source: "description" as const,
        };
      });

      cleanedIssue.relatedIssues = [
        ...(cleanedIssue.relatedIssues || []),
        ...links,
      ];
    }

    if (issue.fields?.parent) {
      cleanedIssue.parent = {
        id: issue.fields.parent.id,
        key: issue.fields.parent.key,
        summary: issue.fields.parent.fields?.summary,
      };
    }

    if (issue.fields?.customfield_10014) {
      cleanedIssue.epicLink = {
        id: issue.fields.customfield_10014,
        key: issue.fields.customfield_10014,
        summary: undefined,
      };
    }

    if (issue.fields?.subtasks?.length > 0) {
      cleanedIssue.children = issue.fields.subtasks.map((subtask: any) => ({
        id: subtask.id,
        key: subtask.key,
        summary: subtask.fields?.summary,
      }));
    }

    return cleanedIssue;
  }

  //111111
  // async fetchJson<T>(url: string, init?: RequestInit, obj?: any): Promise<T> {
  //   const response = await fetch(this.baseUrl + url, {
  //     ...init,
  //     headers: this.headers,
  //   });
  //   console.log("JIRA API Response:", response);
  //   if (!response.ok) {
  //     await this.handleFetchError(response, url, obj);
  //   }

  //   return response.json();
  // }

  //2222222
  // async fetchJson<T>(url: string, init?: RequestInit, obj?: any): Promise<T> {
  //   const fullUrl = url.startsWith("http") ? url : `${this.baseUrl}${url}`;
  //   const options = {
  //     ...init,
  //     headers: {
  //       ...this.headers,
  //       ...(init?.headers || {}),
  //     },
  //   };
  //   logger.info(`[JiraApiService.fetchJson] Attempting to fetch: ${fullUrl}`);
  //   const response = await fetch(fullUrl, options);
  //   logger.info(`[JiraApiService.fetchJson] Response status for ${fullUrl}: ${response.status}`);

  //   if (!response.ok) {
  //     logger.error(`[JiraApiService.fetchJson] Error status ${response.status} for ${fullUrl}`);
  //     return this.handleFetchError(response, fullUrl, obj); // This throws
  //   }

  //   if (response.status === 204) {
  //     logger.info(`[JiraApiService.fetchJson] Received 204 No Content for ${fullUrl}`);
  //     return undefined as T;
  //   }

  //   try {
  //     const data = await response.json();
  //     logger.info(`[JiraApiService.fetchJson] Successfully fetched and parsed JSON for ${fullUrl}. Data snippet:`, JSON.stringify(data).substring(0, 200) + "...");
  //     return data as T;
  //   } catch (e) {
  //     logger.error(`[JiraApiService.fetchJson] Error parsing JSON for ${fullUrl} (Status: ${response.status}):`, e);
  //     throw new Error(
  //       `Failed to parse JSON response from ${fullUrl}. Status: ${response.status}`,
  //     );
  //   }
  // }

  async fetchJson<T>(url: string, init?: RequestInit, obj?: any): Promise<T> {
    const fullUrl = url.startsWith("http") ? url : `${this.baseUrl}${url}`;
    
    // Explicitly create headers for this request
    const requestHeaders = new Headers(this.headers); // Start with common headers

    // Merge any headers from init
    if (init?.headers) {
        const initHeaders = new Headers(init.headers);
        initHeaders.forEach((value, key) => {
            requestHeaders.set(key, value);
        });
    }

    const options = {
      ...init,
      headers: requestHeaders, // Use the combined headers
    };

    // Log the headers that will be sent
    const headersToLog: Record<string, string> = {};
    options.headers.forEach((value, key) => {
      headersToLog[key] = key.toLowerCase() === 'authorization' ? `${value.substring(0, 15)}... (hidden)` : value;
    });
    logger.debug(`[JiraApiService.fetchJson] Attempting to fetch: ${fullUrl} with method: ${options.method || 'GET'}`);
    logger.debug(`[JiraApiService.fetchJson] Request Headers for ${fullUrl}:`, JSON.stringify(headersToLog));

    const response = await fetch(fullUrl, options);
    logger.info(`[JiraApiService.fetchJson] Response status for ${fullUrl}: ${response.status}`);

    if (!response.ok) {
      logger.error(`[JiraApiService.fetchJson] Error status ${response.status} for ${fullUrl}`);
      return this.handleFetchError(response, fullUrl, obj);
    }

    if (response.status === 204) { // No Content
      logger.info(`[JiraApiService.fetchJson] Received 204 No Content for ${fullUrl}`);
      return undefined as T; // Or handle as appropriate for your application
    }

    try {
      const data = await response.json();
      logger.debug(`[JiraApiService.fetchJson] Successfully fetched and parsed JSON for ${fullUrl}.`);
      return data as T;
    } catch (e) {
      logger.error(`[JiraApiService.fetchJson] Error parsing JSON for ${fullUrl} (Status: ${response.status}):`, e);
      // Attempt to get text for more context if JSON parsing fails
      try {
        const textResponse = await response.text();
        logger.error(`[JiraApiService.fetchJson] Text response for ${fullUrl} when JSON parsing failed:`, textResponse.substring(0, 500));
      } catch (textErr) {
        logger.error(`[JiraApiService.fetchJson] Could not get text response for ${fullUrl} either.`);
      }
      throw new Error(
        `Failed to parse JSON response from ${fullUrl}. Status: ${response.status}`
      );
    }
  }

  async searchIssues(searchString: string): Promise<SearchIssuesResponse> {
    const params = new URLSearchParams({
      jql: searchString,
      maxResults: "50",
      fields: [
        "id",
        "key",
        "summary",
        "description",
        "status",
        "created",
        "updated",
        "parent",
        "subtasks",
        "customfield_10014",
        "issuelinks",
      ].join(","),
      expand: "names,renderedFields",
    });

    const data = await this.fetchJson<any>(`/rest/api/3/search?${params}`);

    return {
      total: data.total,
      issues: data.issues.map((issue: any) => this.cleanIssue(issue)),
    };
  }

  async getEpicChildren(epicKey: string): Promise<CleanJiraIssue[]> {
    const params = new URLSearchParams({
      jql: `"Epic Link" = ${epicKey}`,
      maxResults: "100",
      fields: [
        "id",
        "key",
        "summary",
        "description",
        "status",
        "created",
        "updated",
        "parent",
        "subtasks",
        "customfield_10014",
        "issuelinks",
      ].join(","),
      expand: "names,renderedFields",
    });

    const data = await this.fetchJson<any>(`/rest/api/3/search?${params}`);

    const issuesWithComments = await Promise.all(
      data.issues.map(async (issue: any) => {
        const commentsData = await this.fetchJson<any>(
          `/rest/api/3/issue/${issue.key}/comment`
        );
        const cleanedIssue = this.cleanIssue(issue);
        const comments = commentsData.comments.map((comment: any) =>
          this.cleanComment(comment)
        );

        const commentMentions = comments.flatMap(
          (comment: CleanComment) => comment.mentions
        );
        cleanedIssue.relatedIssues = [
          ...cleanedIssue.relatedIssues,
          ...commentMentions,
        ];

        cleanedIssue.comments = comments;
        return cleanedIssue;
      })
    );

    return issuesWithComments;
  }

  // async getIssueWithComments(issueId: string): Promise<CleanJiraIssue> {
  //   const params = new URLSearchParams({
  //     fields: [
  //       "id",
  //       "key",
  //       "summary",
  //       "description",
  //       "status",
  //       "created",
  //       "updated",
  //       "parent",
  //       "subtasks",
  //       "customfield_10014",
  //       "issuelinks",
  //     ].join(","),
  //     expand: "names,renderedFields",
  //   });

  //   let issueData, commentsData;
  //   try {
  //     [issueData, commentsData] = await Promise.all([
  //       this.fetchJson<any>(`/rest/api/3/issue/${issueId}?${params}`),
  //       this.fetchJson<any>(`/rest/api/3/issue/${issueId}/comment`),
  //     ]);
  //   } catch (error: any) {
  //     if (error instanceof Error && error.message.includes("(Status: 404)")) {
  //       throw new Error(`Issue not found: ${issueId}`);
  //     }

  //     throw error;
  //   }

  //   const issue = this.cleanIssue(issueData);
  //   const comments = commentsData.comments.map((comment: any) =>
  //     this.cleanComment(comment)
  //   );

  //   const commentMentions = comments.flatMap(
  //     (comment: CleanComment) => comment.mentions
  //   );
  //   issue.relatedIssues = [...issue.relatedIssues, ...commentMentions];

  //   issue.comments = comments;

  //   if (issue.epicLink) {
  //     try {
  //       const epicData = await this.fetchJson<any>(
  //         `/rest/api/3/issue/${issue.epicLink.key}?fields=summary`
  //       );
  //       issue.epicLink.summary = epicData.fields?.summary;
  //     } catch (error) {
  //       console.error("Failed to fetch epic details:", error);
  //     }
  //   }

  //   return issue;
  // }

  async getIssueWithComments(issueId: string): Promise<CleanJiraIssue> {
    logger.info(`[JiraApiService.getIssueWithComments] Started for issueId: ${issueId}`);
    const params = new URLSearchParams({
      fields: [
        "id", "key", "summary", "description", "status", "created", "updated",
        "parent", "subtasks", "customfield_10014", "issuelinks",
      ].join(","),
      expand: "names,renderedFields",
    });

    let issueData, commentsData;
    try {
      logger.info(`[JiraApiService.getIssueWithComments] Fetching issue and comments in parallel for: ${issueId}`);
      [issueData, commentsData] = await Promise.all([
        this.fetchJson<any>(`/rest/api/3/issue/${issueId}?${params}`),
        this.fetchJson<any>(`/rest/api/3/issue/${issueId}/comment`),
      ]);
      logger.info(`[JiraApiService.getIssueWithComments] Successfully fetched parallel data for: ${issueId}`);
    } catch (error: any) {
      logger.error(`[JiraApiService.getIssueWithComments] Error fetching issue/comments for ${issueId}:`, error);
      if (error instanceof Error && error.message.includes("(Status: 404)")) {
        throw new Error(`Issue not found: ${issueId}`);
      }
      throw error;
    }

    logger.info(`[JiraApiService.getIssueWithComments] Cleaning issue data for: ${issueId}`);
    const issue = this.cleanIssue(issueData);
    logger.info(`[JiraApiService.getIssueWithComments] Cleaning comments data for: ${issueId}`);
    const comments = commentsData.comments.map((comment: any) =>
      this.cleanComment(comment)
    );

    const commentMentions = comments.flatMap(
      (comment: CleanComment) => comment.mentions
    );
    issue.relatedIssues = [...issue.relatedIssues, ...commentMentions];
    issue.comments = comments;

    if (issue.epicLink && issue.epicLink.key) { // Ensure key exists
      logger.info(`[JiraApiService.getIssueWithComments] Fetching epic details for epic: ${issue.epicLink.key}`);
      try {
        const epicData = await this.fetchJson<any>(
          `/rest/api/3/issue/${issue.epicLink.key}?fields=summary`
        );
        issue.epicLink.summary = epicData.fields?.summary;
        logger.info(`[JiraApiService.getIssueWithComments] Successfully fetched epic details for: ${issue.epicLink.key}`);
      } catch (error) {
        logger.error(`[JiraApiService.getIssueWithComments] Failed to fetch epic details for ${issue.epicLink.key}:`, error);
        // Not re-throwing, so epic summary might just be missing
      }
    }
    logger.info(`[JiraApiService.getIssueWithComments] Finished processing for: ${issueId}. Returning cleaned issue.`);
    return issue;
  }

  async createIssue(
    projectKey: string,
    issueType: string,
    summary: string,
    description: string, // Changed from description?: string
    acceptanceCriteria: string, // New parameter
    processAreaOwnerName: string, // New parameter
    storyPoints: number, // New parameter
    sprintName: string, // New optional parameter - SPRINT CUSTOM FIELD ID NEEDS TO BE SET
    priorityName?: string, // New optional parameter
    labels?: string[], // New optional parameter
    assigneeName?: string, // New optional parameter
    parentIssueKey?: string, // New optional parameter
    additionalFields?: Record<string, any>
  ): Promise<{ id: string; key: string }> {

    const descriptionAdf = this.createAdfFromBody(description);
    const acceptanceCriteriaAdf = this.createAdfFromBody(acceptanceCriteria);
    
    // Resolve Process Area Owner
    const resolvedOwnerAccountId = processAreaOwnerName ? await this.findUserAccountIdByName(processAreaOwnerName, projectKey) : undefined;
    if (processAreaOwnerName && !resolvedOwnerAccountId) {
        // This is a required field as per your schema, so throw error
        throw new McpError(ErrorCode.InvalidParams, `Could not resolve Process Area Owner account ID for name: "${processAreaOwnerName}" in project ${projectKey}.`);
    }
    
    // Resolve Assignee
    const resolvedAssigneeAccountId = assigneeName ? await this.findUserAccountIdByName(assigneeName, projectKey) : undefined;
    if (assigneeName && !resolvedAssigneeAccountId) {
        console.warn(`Could not resolve assignee account ID for name: "${assigneeName}". Assignee will not be set.`);
        // Don't throw if assignee is optional
    }

    // Resolve Sprint
    let resolvedSprintId: number | undefined;
    if (sprintName) {
        resolvedSprintId = await this.findSprintIdByName(sprintName, this.DEFAULT_BOARD_ID_FOR_SPRINT_RESOLUTION);
        if (!resolvedSprintId) {
            console.warn(`Could not resolve sprint ID for name: "${sprintName}". Sprint will not be set.`);
            // If sprint is required by schema and not found, you might throw here.
            // Your schema makes sprintName required, but findSprintIdByName can return undefined.
            // Let's assume if sprintName is given, it should be found.
            // throw new McpError(ErrorCode.InvalidParams, `Could not resolve Sprint ID for name: "${sprintName}" on board ${this.DEFAULT_BOARD_ID_FOR_SPRINT_RESOLUTION}.`);
        }
    }

    // Resolve Priority
    let resolvedPriorityObject: { name: string } | { id: string } | undefined;
    if (priorityName) {
        const priorityId = await this.cacheService.getPriorityIdByName(priorityName); // Assuming cacheService has this
        if (priorityId) {
            resolvedPriorityObject = { id: priorityId }; // Jira often prefers ID for setting priority
        } else {
            // Fallback to name if ID not found, or warn/error
            console.warn(`Could not resolve priority ID for name: "${priorityName}". Attempting to set by name.`);
            resolvedPriorityObject = { name: priorityName };
        }
         if (!resolvedPriorityObject) { // If priorityName was given but not resolved
            throw new McpError(ErrorCode.InvalidParams, `Could not resolve Priority for name: "${priorityName}".`);
        }
    }


    const SPRINT_CUSTOM_FIELD_ID = await this.cacheService.getCustomFieldIdByName("Sprint") || "customfield_10020"; // Fallback
    const STORY_POINTS_CUSTOM_FIELD_ID = await this.cacheService.getCustomFieldIdByName("Story Points") || "customfield_10058";
    const ACCEPTANCE_CRITERIA_CUSTOM_FIELD_ID = await this.cacheService.getCustomFieldIdByName("Acceptance Criteria") || "customfield_10085";
    const PROCESS_AREA_OWNER_CUSTOM_FIELD_ID = await this.cacheService.getCustomFieldIdByName("Process Area Owner") || "customfield_10426";


    const fieldsPayload: Record<string, any> = {
      project: { key: projectKey },
      summary,
      issuetype: { name: issueType }, // Assuming name is sufficient, or resolve to ID from cache
      description: descriptionAdf,
      [ACCEPTANCE_CRITERIA_CUSTOM_FIELD_ID]: acceptanceCriteriaAdf,
      [PROCESS_AREA_OWNER_CUSTOM_FIELD_ID]: resolvedOwnerAccountId ? { accountId: resolvedOwnerAccountId } : undefined,
      [STORY_POINTS_CUSTOM_FIELD_ID]: storyPoints,
    };
    
    if (resolvedAssigneeAccountId) {
        fieldsPayload.assignee = { accountId: resolvedAssigneeAccountId };
    }
    if (resolvedSprintId !== undefined) { // Only add sprint if it was resolved
        fieldsPayload[SPRINT_CUSTOM_FIELD_ID] = resolvedSprintId;
    }
    if (resolvedPriorityObject) {
        fieldsPayload.priority = resolvedPriorityObject;
    }
    if (labels && labels.length > 0) {
      fieldsPayload.labels = labels;
    }
    if (parentIssueKey) {
      fieldsPayload.parent = { key: parentIssueKey };
    }
    if (additionalFields) {
      for (const key in additionalFields) {
        if (Object.prototype.hasOwnProperty.call(additionalFields, key)) {
          fieldsPayload[key] = additionalFields[key];
        }
      }
    }
    // Remove undefined fields from payload
    Object.keys(fieldsPayload).forEach(key => fieldsPayload[key] === undefined && delete fieldsPayload[key]);

    const payload = { fields: fieldsPayload };

    return this.fetchJson<{ id: string; key: string }>("/rest/api/3/issue", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async updateIssue(
    issueKey: string,
    fields: Record<string, any>
  ): Promise<void> {
    await this.fetchJson(`/rest/api/3/issue/${issueKey}`, {
      method: "PUT",
      body: JSON.stringify({ fields }),
    });
  }

  async getTransitions(
    issueKey: string
  ): Promise<Array<{ id: string; name: string; to: { name: string } }>> {
    const data = await this.fetchJson<any>(
      `/rest/api/3/issue/${issueKey}/transitions`
    );
    return data.transitions;
  }

  async transitionIssue(
    issueKey: string,
    transitionId: string,
    comment?: string
  ): Promise<void> {
    const payload: any = {
      transition: { id: transitionId },
    };

    if (comment) {
      payload.update = {
        comment: [
          {
            add: {
              body: {
                type: "doc",
                version: 1,
                content: [
                  {
                    type: "paragraph",
                    content: [
                      {
                        type: "text",
                        text: comment,
                      },
                    ],
                  },
                ],
              },
            },
          },
        ],
      };
    }

    await this.fetchJson(`/rest/api/3/issue/${issueKey}/transitions`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async addAttachment(
    issueKey: string,
    file: Buffer,
    filename: string
  ): Promise<{ id: string; filename: string }> {
    const formData = new FormData();
    // formData.append("file", new Blob([file]), filename);
    formData.append("file", new Blob([new Uint8Array(file)]), filename);

    const headers = new Headers(this.headers);
    headers.delete("Content-Type");
    headers.set("X-Atlassian-Token", "no-check");

    const response = await fetch(
      `${this.baseUrl}/rest/api/3/issue/${issueKey}/attachments`,
      {
        method: "POST",
        headers,
        body: formData,
      }
    );

    if (!response.ok) {
      await this.handleFetchError(response);
    }

    const data = await response.json();

    const attachment = data[0];
    return {
      id: attachment.id,
      filename: attachment.filename,
    };
  }

  /**
   * Converts plain text to a basic Atlassian Document Format (ADF) structure.
   */
  private createAdfFromBody(text: string): AdfDoc {
    return {
      version: 1,
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: text,
            },
          ],
        },
      ],
    };
  }

  /**
   * Adds a comment to a JIRA issue.
   */
  async addCommentToIssue(
    issueIdOrKey: string,
    body: string
  ): Promise<AddCommentResponse> {
    const adfBody = this.createAdfFromBody(body);

    const payload = {
      body: adfBody,
    };

    const response = await this.fetchJson<JiraCommentResponse>(
      `/rest/api/3/issue/${issueIdOrKey}/comment`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    );

    return {
      id: response.id,
      author: response.author.displayName,
      created: response.created,
      updated: response.updated,
      body: this.extractTextContent(response.body.content),
    };
  }

   /**
   * Fetches issues from a specific board, optionally filtered by JQL.
   * Handles pagination to retrieve all issues.
   * Note: This method uses the Agile API, which might be limited for fetching all desired fields like comments in bulk.
   * Consider using searchDetailedIssues for richer data fetching.
   */
  async getBoardIssues(
    boardId: string,
    jqlFilter?: string,
    // fields: string[] = ["summary", "status", "assignee", "sprint", "issuetype", "key", "id"], // Agile board API has limited field control
    // expand: string[] = []
  ): Promise<any[]> {
    const allIssues: any[] = [];
    let startAt = 0;
    const maxResults = 50;
    let isLast = false;

    console.log(`[JiraApiService.getBoardIssues] Fetching issues for board ${boardId} with JQL: ${jqlFilter}`);

    while (!isLast) {
      const params = new URLSearchParams({
        startAt: startAt.toString(),
        maxResults: maxResults.toString(),
      });
      if (jqlFilter) {
        params.append("jql", jqlFilter);
      }
      
      const url = `/rest/agile/1.0/board/${boardId}/issue?${params.toString()}`;
      const page = await this.fetchJson<any>(url);

      if (page && page.issues && page.issues.length > 0) {
        allIssues.push(...page.issues);
      }

      isLast = page.isLast !== undefined ? page.isLast : (page.issues?.length || 0) < maxResults;
      startAt += page.issues?.length || 0;

      if (startAt >= (page.total || 0) && (page.total !== undefined)) { 
          isLast = true;
      }
       if ((page.issues?.length || 0) === 0 && !isLast && page.total > 0 && startAt < page.total) {
        // Safety break if API returns 0 issues on a page but indicates more are available
        console.warn(`[JiraApiService.getBoardIssues] Fetched 0 issues on a page for board ${boardId} but not isLast. Breaking to prevent infinite loop. StartAt: ${startAt}, Total: ${page.total}`);
        break;
      }
    }
    console.log(`[JiraApiService.getBoardIssues] Fetched ${allIssues.length} issues for board ${boardId}.`);
    return allIssues;
  }

  /**
   * Searches for issues using JQL and fetches detailed information, handling pagination.
   * @param jql The JQL query string.
   * @param fields Array of fields to retrieve. Defaults to ['*all'].
   * @param maxResultsPerRequest Max results per API call for pagination.
   * @returns A promise that resolves to an array of all found issue objects.
   */
  async searchDetailedIssues(jql: string, fields: string[] = ['*all'], maxResultsPerRequest: number = 50): Promise<any[]> {
    console.log(`[JiraApiService.searchDetailedIssues] Searching with JQL: "${jql}", fields: "${fields.join(',')}"`);
    const allIssues: any[] = [];
    let startAt = 0;
    let totalAvailable = Infinity; // Initialize to a high number

    try {
      while (startAt < totalAvailable) {
        const encodedJql = encodeURIComponent(jql);
        const fieldsParam = fields.join(',');
        const url = `/rest/api/3/search?jql=${encodedJql}&fields=${fieldsParam}&startAt=${startAt}&maxResults=${maxResultsPerRequest}`;
        
        const response = await this.fetchJson<any>(url);

        if (response && response.issues) {
          allIssues.push(...response.issues);
          totalAvailable = response.total || 0; // Update total based on API response
          startAt += response.issues.length;

          if (response.issues.length < maxResultsPerRequest) {
            // If fewer issues are returned than requested, we've reached the end
            break;
          }
        } else {
          // No issues found in this batch or error
          console.warn(`[JiraApiService.searchDetailedIssues] No issues found or unexpected response for JQL: "${jql}" at startAt: ${startAt}`);
          break;
        }
      }
      console.log(`[JiraApiService.searchDetailedIssues] Found ${allIssues.length} issues in total for JQL: "${jql}"`);
      return allIssues;
    } catch (error) {
      console.error(`[JiraApiService.searchDetailedIssues] Error searching issues with JQL "${jql}":`, error);
      throw error; // Re-throw to be handled by the caller
    }
  }
}
