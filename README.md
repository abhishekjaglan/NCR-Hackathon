# JIRA Integration with Model Context Protocol

A comprehensive JIRA integration system built using the Model Context Protocol (MCP) that provides AI-powered assistance for JIRA issue management, GitHub integration, and sprint analytics.

## 🏗️ Architecture Overview

The system consists of three main components:

- **JIRA MCP Server**: Core MCP server that interfaces with JIRA APIs
- **JIRA Client**: Express.js backend that connects to the MCP server and Azure OpenAI
- **Chatbot Frontend**: React-based UI for user interactions

## 📋 Table of Contents

- [Features](#-features)
- [Prerequisites](#-prerequisites)
- [Environment Setup](#-environment-setup)
- [Installation](#-installation)
- [Usage](#-usage)
- [API Endpoints](#-api-endpoints)
- [MCP Tools](#-mcp-tools)
- [Docker Deployment](#-docker-deployment)
- [Configuration](#-configuration)
- [Troubleshooting](#-troubleshooting)

## ✨ Features

### JIRA Operations
- **Issue Management**: Create, update, search, and transition JIRA issues
- **Epic Management**: Retrieve epic children with detailed information
- **Comment System**: Add comments to issues with rich text support
- **Attachment Handling**: Upload and manage file attachments
- **Sprint Integration**: Comprehensive sprint story management and metrics

### AI-Powered Analytics
- **Story Analysis**: AI-generated insights from issue comments and descriptions
- **GitHub Integration**: Automatic linking of commits, PRs, and issues
- **Sprint Metrics**: Detailed sprint performance analytics
- **Workload Analysis**: User-specific story assignments and progress tracking

### Caching & Performance
- **Redis Caching**: Efficient caching of JIRA metadata and user data
- **Live API Integration**: Real-time data fetching with intelligent fallbacks
- **Optimized Queries**: JQL optimization for large-scale data retrieval

## 🔧 Prerequisites

- **Node.js** 20+
- **Bun** runtime
- **Redis** server
- **Docker** & Docker Compose (for containerized deployment)
- **JIRA Cloud** instance with API access
- **Azure OpenAI** service
- **GitHub** access (optional, for enhanced features)

**Currently works without your own credentials, hardocded for PFA board**

## 🌍 Environment Setup

#### Currently #1, #4 and #5 are hard coded.

### 1. JIRA Configuration

Create your JIRA API token and configure the following variables:

```bash
# JIRA Configuration
JIRA_BASE_URL=https://your-instance.atlassian.net
JIRA_USER_EMAIL=your-email@company.com
JIRA_API_TOKEN=your-jira-api-token
```

### 2. Azure OpenAI Configuration

Set up your Azure OpenAI service:

```bash
# Azure OpenAI Configuration
AZURE_ENDPOINT=https://your-resource.openai.azure.com/
AZURE_API_VERSION=2024-02-01
AZURE_API_KEY=your-azure-api-key
AZURE_MODEL=gpt-4o
```

### 3. Redis Configuration

```bash
# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_URL=redis://localhost:6379
```

### 4. GitHub Integration (Optional)

```bash
# GitHub Configuration
GITHUB_TOKEN=ghp_your-github-token
GITHUB_ORG=your-github-organization
GITHUB_BASE_URL=https://api.github.com
```

### 5. Application Configuration

```bash
# Application Settings
PORT=3000
JIRA_MCP_PATH=./jira-mcp/build/index.js
```

## 🚀 Installation

### Docker (Recomended)

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd mcp-test
   ```

2. **Place .env file in root directory**
    Env File available at - https://ncratleos.sharepoint.com/:f:/r/sites/NCRAtleosCultureCouncil/Shared%20Documents/ELEVATE/Mini%20Hackathon%202025/AJ385009%20-%20Abhishek%20Jaglan?csf=1&web=1&e=UNzyHB

3. **Run Docker Comand**
    ```bash
   docker compose up
   ```

### Web Interface

1. Navigate to `http://localhost:4173` (frontend)
2. Start chatting with the AI assistant
3. Use natural language to interact with JIRA:

### Local Development Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd mcp-test
   ```

2. **Install MCP Server dependencies**
   ```bash
   cd jira-mcp
   bun install
   bun add winston
   bun run build
   cd ..
   ```

3. **Install Client dependencies**
   ```bash
   cd jira-client
   npm install
   cd ..
   ```

4. **Install Frontend dependencies**
   ```bash
   cd chatbot-fe
   npm install
   cd ..
   ```

5. **Setup environment files**
   ```bash
   # Copy and configure environment files
   cp jira-client/.env.example jira-client/.env
   # Edit the .env file with your configuration
   ```

6. **Start Redis server**
   ```bash
   # Using Docker
   docker run -d -p 6379:6379 redis:7
   
   # Or using local Redis installation
   redis-server
   ```

7. **Start the application**
   ```bash
   # Start the client (includes MCP server)
   cd jira-client
   npm run dev
   
   # In another terminal, start the frontend
   cd chatbot-fe
   npm run dev
   ```

## 📱 Usage

### Web Interface

1. Navigate to `http://localhost:5173` (frontend)
2. Start chatting with the AI assistant
3. Use natural language to interact with JIRA:

**Example Interactions:**
![alt text](image.png)

![alt text](image-1.png)

![alt text](image-2.png)

![alt text](image-3.png)

![alt text](image-4.png)

![alt text](image-5.png)

![alt text](image-6.png)