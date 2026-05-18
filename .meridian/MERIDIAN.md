# 🗺️ Meridian Project Standards (UNINITIALIZED)

> **ATTENTION AGENT:** This file is currently a placeholder.
> Your primary goal is to initialize the project standards by analyzing the codebase.

## 🤖 Instructions for the Agent
1. **Request Permission:** Ask the user: "The project standards in `.meridian/MERIDIAN.md` are not defined. Would you like me to summon the Meridian agents (Architect and Engineering Manager) to analyze this codebase and initialize the standards for you?"
2. **Analysis:** If permitted, use your tools to analyze:
   - Configuration files (`package.json`, `Cargo.toml`, `requirements.txt`, etc.) for stack and commands.
   - Directory structure for architectural patterns.
   - Existing source code for naming conventions and coding style.
3. **Initialization:** Overwrite this file with the following structured sections:
   - **🎯 Project Overview**: Purpose of the software and core Tech Stack.
   - **🛠️ Critical Commands**: Essential scripts for dev, test, and build.
   - **🏗️ Structure & Navigation**: Map of the main directories and their roles.
   - **📏 Golden Rules**: Non-negotiable coding standards, safety rules, and constraints.
   - **🧪 Quality & Workflow**: How tests are handled and CI/CD expectations.

4. **Expert Recommendation:** After identifying the Tech Stack, if specialized experts are missing from the current configuration (e.g., you found Elixir code but no `elixir-expert` is present), you MUST suggest to the user: "I've detected [Stack Name] in this project. Would you like to run `meridian-sync --add-expert [stack-name]` to summon specialized agents for this technology?"

**Do not proceed with project-wide feature development or refactoring until these standards are established.**

### 🤖 Bot Identity & Agent Simulation (Required)

To maintain a consistent audit trail and simulate that actions (branches, commits, and Pull Requests) are performed by the **Meridian Agent**, you MUST use the automated helper script.

**Using the meridian-agent Wrapper**
The `.meridian/meridian-agent` script acts as a transparent proxy for `git` and `gh` commands, automatically injecting the agent's identity and authentication token.

```bash
# Any git or gh command can be prefixed with meridian-agent
.meridian/meridian-agent git checkout -b feature/agent-task
.meridian/meridian-agent git add src/
.meridian/meridian-agent git commit -m "feat: simulate agent work"
.meridian/meridian-agent gh pr create --title "..." --body "..."
```

### 🤖 Bot Identity & Agent Simulation (Required)

To maintain a consistent audit trail and simulate that actions (branches, commits, and Pull Requests) are performed by the **Meridian Agent**, you MUST use the automated helper script.

**Using the meridian-agent Wrapper**
The `.meridian/meridian-agent` script acts as a transparent proxy for `git` and `gh` commands, automatically injecting the agent's identity and authentication token.

```bash
# Any git or gh command can be prefixed with meridian-agent
.meridian/meridian-agent git checkout -b feature/agent-task
.meridian/meridian-agent git add src/
.meridian/meridian-agent git commit -m "feat: simulate agent work"
.meridian/meridian-agent gh pr create --title "..." --body "..."
```

### 🚀 Auto-Merge
To enable automatic merging for Pull Requests that pass all status checks, run:
```bash
gh pr merge --auto --squash --delete-branch
```

### 🤖 Bot Identity & Agent Simulation (Required)

To maintain a consistent audit trail and simulate that actions (branches, commits, and Pull Requests) are performed by the **Meridian Agent**, you MUST use the automated helper script.

**Using the meridian-agent Wrapper**
The `.meridian/meridian-agent` script acts as a transparent proxy for `git` and `gh` commands, automatically injecting the agent's identity and authentication token.

```bash
# Any git or gh command can be prefixed with meridian-agent
.meridian/meridian-agent git checkout -b feature/agent-task
.meridian/meridian-agent git add src/
.meridian/meridian-agent git commit -m "feat: simulate agent work"
.meridian/meridian-agent gh pr create --title "..." --body "..."
```
