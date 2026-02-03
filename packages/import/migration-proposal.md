# Migration to Linear

This document outlines the plan for migrating from Kanbanize to Linear.

## Goals

- Determine how existing Kanbanize teams will be migrated to Linear with minimal changes to their existing processes.
- Determine how and which data from Kanbanize will be migrated to Linear.
- Outline educational materials for the team to get familiar with Linear.
- Outline the timeline for the migration.
- Determine support channels for the migration period.

## Non-goals

- Ensure that all existing information will be migrated without any loss.

## Kanbanize vs Linear

Before we proceed with the proposed mapping of existing entities in Kanbanize to Linear, it's important to understand the differences between the systems and their entities.

Kanbanize uses the following entities to organize work:
- **User** — an employee
- **Team** — a group of users. The main goal is to simplify access to boards
- **Board** — a representation of workflows of a single team
- **Swimlane** — a representation of different types of workflows inside a team
- **Workspace** — a group of boards used to organize teams of a single department
- **Card** — a representation of a single task
- **Tag** — a property of a card that allows filtering cards

Linear uses the following entities to organize work:
- **Member** — an employee
- **Team** — a representation of a single workflow. The main goal is to organize different types of work functions
- **Project** — a group of issues representing a large unit of work
- **Initiative** — a group of projects representing a company objective
- **Issue** — a representation of a single task
- **Label** — a property of an issue that allows filtering issues and configuring alternative views on the team's work
- **Cycles** — a workflow type that revolves around repeatable time-bound iterations

### Entities mapping

This is how Kanbanize entities are mapped to Linear entities:
- **User** → **Member**
- **Team** → N/A
- **Board** → **Team**
- **Swimlane** → **Sub-team** or **label**-based custom view
- **Workspace** → **Parent Team**
- **Card** → **Issue**, **Project**, or **Initiative** (depending on the amount of work that needs to be represented)
- **Tag** → **Label**

## Current state of Kanbanize

### Teams

- `isms`
- `finance`
- `product`
- `people`
- `management`
- `it-infrastructure`
- `marketing`
- `engineering`
- `engineering/architect`
- `engineering/security`
- `engineering/qa`
- `engineering/devops`
- `engineering/frontend`
- `engineering/backend`
- `Global`

### Workspaces, Boards and their Swimlanes

> [!NOTE]
> The following information about Kanbanize is structured in a multilevel list in this format: `Workspace` > `Board` > `Swimlane`

> [!NOTE]
> **Legend**:
> - **Statuses** indicate card's workflow configuration, which can be `default` (Todo > In Progress > Done) or `custom`.
> - **initiative** means that the swimlane is configured to contain umbrella cards for some projects.
> - **cycles** means that the process behind this swimlane is trying to recreate work in cyclic cadences, similar to scrum.

- **Marketing**
  - General Marketing (ID: `56`) — To be archived; Agreed with Elvira as Boards Owner
  - Events (ID: `57`) — To be archived; Agreed with Elvira as Boards Owner
    - Initiatives (Statuses: `default`, initiative)
    - Events (Statuses: `custom`)
  - Initiatives - MQLs (ID: `69`)
    - Initiatives (Statuses: `default`, initiative)
    - Expedite (Statuses: `default`)
    - Content (Statuses: `custom`)
  - OKR 1: Website renovation (ID: `77`) — To be archived; Agreed with Elvira as Boards Owner
    - Initiatives (Statuses: `default`, initiative)
    - Cards (Statuses: `custom`)

- **Engineering**
  - Documentation (ID: `75`)
    - Initiatives (Statuses: `default`, initiative)
    - Public documentation (Statuses: `default`)
    - Johny Decimal (Portal) (Statuses: `default`)
  - Role: Backend (ID: `7`)
    - Hiring (Statuses: `default`)
    - Initiatives (Statuses: `default`, initiative)
    - Expedite (Statuses: `default`)
    - Default (Statuses: `default`)
  - Role: Frontend (ID: `8`)
    - Expedite (Statuses: `default`)
    - Default (Statuses: `default`)
  - Role: Security (ID: `9`)
    - Hiring (Statuses: `default`)
    - Expedite (Statuses: `default`)
    - Default (Statuses: `default`)
  - Role: DevOps (ID: `10`)
    - Incidents (Statuses: `custom`)
    - Incoming requests (Statuses: `custom`)
    - On-call (Statuses: `custom`)
    - Hiring (Statuses: `default`)
    - Infrastructure - Expedite (Statuses: `custom`)
    - Infrastructure (Statuses: `custom`)
    - Initiatives (Statuses: `default`, initiative)
    - DevOps - Expedite (Statuses: `default`)
    - DevOps (Statuses: `default`)
  - Role: QA (ID: `11`)
    - Acceptance (Statuses: `custom`)
    - Hiring (Statuses: `default`)
    - Expedite (Statuses: `default`)
    - Default (Statuses: `default`)
  - Coordination (ID: `13`)
    - Customer Feedback / Ideas (Statuses: `default`)
    - Features - Expedite (Statuses: `custom`, initiative)
    - Features - Product (Statuses: `custom`, initiative)
    - Features - Content (Statuses: `custom`, initiative)
    - Features - Architecture (Statuses: `custom`, initiative)
    - Features - Resilience (Statuses: `custom`, initiative)
    - Features - Cost reduction (Statuses: `custom`, initiative)
    - Features - Prototypes (Statuses: `custom`, initiative)
  - Role: Architect (ID: `15`)
    - Feature Clarification & Design (Statuses: `default`)
    - Hiring (Statuses: `default`)
    - Expedite (Statuses: `default`)
    - Regular (Statuses: `default`)
  - SDK (ID: `65`)
    - Initiatives (Statuses: `default`, initiative)
    - Fern + Infrastructure (Statuses: `default`)
    - Java SDK (Statuses: `default`)
    - Typescript SDK (Statuses: `default`)
    - Python SDK (Statuses: `default`)
    - Go SDK (Statuses: `default`)
  - Role: Tech Owner (ID: `59`)
    - Cards (Statuses: `default`)
  - Role: Organizational Efficiency (ID: `58`)
    - Cards (Statuses: `default`)

- **IT Endpoint Infrastructure**
  - Requests from engineering team (ID: `40`) — To be archived; use general communication channel with IT department outlined in [Slack](https://truvityhq.slack.com/archives/C031RM4E4CC/p1747732681000319)
    - Cards (Statuses: `default`)

- **GDPR**
  - GDPR Board (ID: `16`)
    - Deletion (Statuses: `default`)
    - Rectification (Statuses: `default`)
    - Data Dump (Statuses: `default`)
    - Other (Statuses: `default`)

- **External Security Reports**
  - External Security Reports (ID: `21`)
    - Initiatives (Statuses: `default`, initiative)
    - Cards (Statuses: `custom`)

- **PeopleOps**
  - Requests (ID: `22`) — To be archived; Agreed with Liza as Boards Owner
  - Process Landscape (LLHO) (ID: `23`) — To be archived; Agreed with Liza as Boards Owner
  - Kanbanize (ID: `24`) — To be archived; Agreed with Liza as Boards Owner
  - PeopleOps-MainBoard (old) (ID: `42`) — To be archived; Agreed with Liza as Boards Owner
  - Hiring (ID: `50`) — To be archived; Agreed with Liza as Boards Owner
  - PeopleOps-MainBoard (ID: `79`)
    - Initiatives (Statuses: `default`, initiative)
    - Expedited (Statuses: `default`)
    - Cards (Statuses: `custom`, cycles?)

- **Workspace for "engineering" tests**
  - [local] GDPR Board (ID: `31`)
  - [devel] GDPR Board (ID: `32`)
  - [sandbox] GDPR Board (ID: `33`)

- **Finance**
  - Finance work plan (ID: `53`) — Should be archived? Hasn't been updated in 1 year.

- **Information Security Management**
  - Security vulnerabilities (ID: `80`)
    - Cards (Statuses: `default`)
  - ISMS (ID: `78`)
    - Initiatives (Statuses: `default`, initiative)
    - Nonconformities (Statuses: `default`)
    - ISMS Changes (Statuses: `default`)
    - Vendors review (Statuses: `default`)
    - Other tasks (Statuses: `default`)

- **Product**
  - Main Board (ID: `74`)
    - Initiatives (Statuses: `default`, initiative)
    - Cards (Statuses: `default`)

## Proposed solution

### Teams taxonomy

Since, according to the [entities mapping](#entities-mapping), **Workspaces**, **Boards**, and **Swimlanes** from Kanbanize are mapped to **Teams** in Linear, the [current configuration](#workspaces-boards-and-their-swimlanes) is going to be represented as the following structure of teams:

```
.
├── SteerCo (private)
├── OEM
├── ISMS (private)
│   └── Security Response (private)
├── HR (private)
│   ├── Backend Hiring (private)
│   └── Frontend Hiring (private)
├── Finance (private)
│   └── Payroll (private + cycles)
├── Marketing (cycles)
├── GDPR
│   ├── Production (private)
│   ├── Stage (private)
│   ├── Devel
│   └── Sandbox
├── Product
└── Engineering
    ├── Incident Management
    ├── Documentation
    ├── Portal
    ├── Backend
    ├── Frontend
    ├── Security
    ├── DevOps
    │   └── Infra
    ├── QA
    ├── Architect
    ├── SDK
    │   ├── Fern+Infra
    │   ├── Java
    │   ├── TypeScript
    │   ├── Python
    │   └── Go
    └── Tech Owner
```

#### General clarification on the Initiatives swimlane migration

In Kanbanize, the Initiatives swimlanes are responsible for managing cards that represent large units of work such as epics.

In Linear, **Projects** and **Initiatives** are responsible for such organization.

Since **Projects** can be shared between multiple teams and support **Milestones**, it is even easier to represent the necessary work.

#### Clarification on Coordination board migration

The Coordination board is used to organize **cards** for developing various product-related features.

Linear has a dedicated entity for such tasks, called a **Project**. Since **Projects** in Linear are assigned to teams, this maps well to the current Coordination **swimlanes**:
- Customer Feedback / Ideas → **Triage** inside the `Product` team
- Features - Product → **Project** inside the `Product` team
- Features - Content → **Project** inside the `Marketing` team
- Features - Architecture → **Project** inside the `Architect` team
- Features - Resilience → **Project** inside the `DevOps` team
- Features - Cost reduction → **Project** inside the `DevOps` team
- Features - Prototypes → **Project** inside the `Engineering` team

#### Clarification on DevOps board migration

The current DevOps board in Kanbanize has a lot of swimlanes representing various workflows and the team's daily routines. It's quite complex due to Kanbanize not being flexible enough to simply support DevOps needs.

Linear has several built-in features to support operational workflows such as:
- Issues triage — default tasks inbox that allows performing initial analysis and routing
- Linear Ask — Slack integration that allows creating issues from discussions and sending them to a specific team Triage inbox. Additionally, this feature allows automatically reporting **Issue** status updates to Slack and establishing a bi-directional communication channel between Slack and issues
- First-class integration with several on-call solutions such as incidents.io and Rootly

With this in mind, we're going to reorganize the current boards the following way:
- Incidents → Moved to a separate team named `Incident Management`
- Incoming requests → Replaced with Issues triage in the `DevOps` team and a `Request` **label**
- On-call → Replaced with Issues triage inside the `DevOps` team and an `On-Call` **label**
- Infrastructure → `Infrastructure` sub-team inside the `DevOps` team due to a different workflow
- Initiatives → **Projects** inside the `DevOps` team
- DevOps → `DevOps` team

#### Clarification on Hiring boards migration

Hiring activities are the responsibilities of the `HR` department, and all related tasks must be managed within their team.

Additionally, when it comes to hiring activities and candidate review, everyone involved might get access to PII, which should not be accessible to everyone. Therefore, any task related to hiring should be organized as part of a specific private sub-team inside the `HR` team.

#### Clarification on Marketing workspace migration

As discussed with Elvira (Boards Owner), currently only the `Initiatives - MQLs` board is used to track tasks and the target organization of the tasks is expected to perform in a single place with dynamic separation of activities via labels and custom views.

#### Clarification on PeopleOps workspace migration

As discussed with Liza (Boards Owner), currently only the `PeopleOps-MainBoard` board is used to track tasks and the target organization of the tasks is expected to perform in a single place.

##### Payroll

An additional identified stream of work for the HR team is managing monthly payroll, which consists of recurring tasks that must be completed each month.

Since this is a finance-related activity, it's proposed to manage it as part of a separate `Payroll` sub-team.

This team workflow will be configured with **cycles** to match the payroll cycles, and during planning of the next cycle, a specifically crafted project template with pre-defined issues will be created to simplify work management.

The created project will have health checks so that the Finance team can easily track any issues and progress.

#### Clarification on External Security Reports boards migration

Previously, the `External Security Reports` board in Kanbanize was created to manage task tracking for any reports sent to `security@truvity.com`, but it has not been actively used.

To streamline handling such reports in Linear, we'll do the following:
1. Create a private `Security Response` sub-team as part of the ISMS team.
2. This team will have configured Linear Ask for email integration with `security@truvity.com`.
3. All emails sent to `security@truvity.com` will automatically create a task in the team's triage with a required SLA, with Roman Sherbakov as the triage lead.

Essentially, this means that when someone sends an email to `security@truvity.com`, a new issue is created in the `Security Response` team triage with a pre-configured SLA and assigned to Roman. He'll immediately receive a notification and will start assessing the issue with the ability to respond within the Linear issue and, if necessary, create linked issues for fixes.

#### Clarification on GDPR boards migration

Currently, all GDPR requests from the Admin Panel are converted to cards in Kanbanize GDPR boards via API.

The current Kanbanize API integration can be found [here](https://github.com/truvity/admin/blob/b38070f4f0c1a522f5044306e22e0011f4a1d7d7/internal/handler/admin/server.go#L40-L63).

To migrate and streamline handling such requests in Linear, we'll do the following:
1. The Admin Panel integration with Kanbanize will be updated to use the [Linear API](https://linear.app/developers/graphql) with the following adjustments:
   1. Each environment (`sandbox`, `devel`, `stage`, and `prod`) will have its own team in Linear.
   2. Teams for managing requests from the `stage` and `prod` environments will be private, and only Roman Sherbakov (as DPO) and Oleg Tsarev (as VPoE) will have access to them.
   3. API authentication for each environment will be performed by an [API key](https://linear.app/developers/graphql#personal-api-keys) with strict permissions to only create new issues in a specific team.
   4. All new requests will be created in the team's triage.
      1. For the `stage` and `prod` teams, additionally, an SLA will be applied and Roman Sherbakov will be assigned as the triage lead.
      2. For the `sandbox` and `devel` teams, no SLA or triage leads will be assigned. Issue status automation will be configured to close inactive issues after 1 month of inactivity to avoid clutter.
   5. Request types will be handled by labels in Linear, which will allow configuring custom views.
2. The email intake from `privacy@truvity.com` will be configured via Linear Ask for email integration and will create issues in the triage for the `prod` team, with an SLA and Roman Sherbakov as the triage lead.

### Data migration

Unfortunately, due to Kanbanize being a niche task tracker, it doesn't have any integration with the Linear importer nor any solutions to export data that can later be imported into Linear.

The only possible solution for data migration would be to use the [CLI importer](https://github.com/linear/linear/tree/master/packages/import) from Linear and write a migration adapter for Kanbanize that will allow importing cards from Kanbanize to teams in Linear.

#### Migration agreements with Board Owners

> [!NOTE]
> Boards that are not mentioned below will not be migrated.

- **Marketing**:
  - `Initiatives - MQLs` — all cards that are not done.

- **HR**:
  - `PeopleOps-MainBoard` — all cards.

- **Security**:
  - `Role: Security` — all cards.
  - `ISMS` — all cards.
  - `GDPR` — all cards.

- **Engineering**:
  - `Portal` — all cards that are not done.
  - `Backend` — all cards that are not done.

#### Migration plan

1. Implement a prototype with full data migration of cards from one test swimlane to a test Linear team (see [Migration algorithm](#migration-algorithm) for more details). The outcomes of the prototype:
   1. A working data migration adapter for the Linear CLI importer
   2. A report detailing known limitations
2. Agree with the Kanbanize board owners on:
   1. Which migration strategy they require: full history migration or migration of unstarted and incomplete cards
   2. The migration date of their boards
3. On the agreed migration date, access to the board in Kanbanize will be set to read-only, and the data migration will be conducted.
4. Once the data migration is completed, the board owner will receive access to Linear to verify that everything has been successfully migrated.
5. Once confirmation has been received, all team members will receive access to Linear and will start working in it.
6. Successfully migrated boards in Kanbanize will continue to be available in read-only mode during the sunsetting period outlined in the [Expected timeline](#expected-timeline).

#### Migration algorithm

1. The CLI importer with Kanbanize adapter is invoked with the following configuration:
   1. Source board ID in Kanbanize
   2. Source swimlane ID in Kanbanize
   3. Target team ID in Linear
   4. Mapping of Kanbanize Card statuses to Linear Issue statuses
   5. Migration strategy
2. Start migration validation:
   1. Check card relations. If there are links to cards from boards and swimlanes whose mappings haven't been configured, the migration should fail with diagnostics.
3. Start importing cards one by one:
   1. Copy card titles as is
   2. Issue description should contain:
      1. Start with a markdown section that will include the following information:
         1. URL of the card in Kanbanize
         2. Kanbanize card ID in `kn-123` format
         3. List of card titles and their relations to the migrated card if they are filtered out due to the chosen migration strategy
         4. Any additional information that can't be directly mapped to Issue attributes in Linear
      2. Original description from Kanbanize
   3. Comments must be imported, including the correct dates of the original comments
   4. Relations must be imported with relation directions according to those in Kanbanize
   5. Attachments must be migrated with their original names
   6. The link to the created Linear issue is posted as a comment to the original Kanbanize card

### Automations migration

#### Current state

1. Business rules in Kanbanize that fall into the following categories:
   1. Create recurring cards with necessary owners and due dates
   2. Send email notifications for created cards
   3. Status automations for initiatives based on child cards
2. Integrations with third-party services:
   1. Integration with `Steady` via in-house solution (`kanbanize2statushero`)

#### Target state

**Business rules migration**:
1. Linear supports creating [recurring issues](https://linear.app/docs/creating-issues#create-recurring-issues) based on a template. This completely covers item 1.1.
2. Email notifications were previously required to set up communication between engineers and the IT department. This can be replaced by using [direct communication with the IT department via Zendesk](https://truvityhq.slack.com/archives/C031RM4E4CC/p1747732681000319).
3. Linear has built-in [status automation](https://linear.app/docs/parent-and-sub-issues#status-automation) for projects. However, it's not as powerful as in Kanbanize. If we need something more powerful in the future, we can use one of the existing [automation integrations](https://linear.app/integrations/automations).

**Integrations with third-party services**:
1. Linear has built-in [integration with Steady](https://linear.app/integrations/steady). This means we can decommission our in-house solution (`kanbanize2statushero`).

#### Additional integrations

Since Linear provides a huge list of powerful integrations, we're going to configure the following integrations:
1. [GitHub](https://linear.app/integrations/github)
2. [Slack](https://linear.app/integrations/slack)
3. [CodeRabbit](https://linear.app/integrations/coderabbit)
4. [Steady](https://linear.app/integrations/steady)
5. [GitHub Copilot](https://linear.app/integrations/github-copilot) for users opted in to GitHub Copilot Business
6. [Fellow](https://linear.app/integrations/fellow)
7. [Google Calendar](https://linear.app/integrations/google-calendar)

### Policies and document updates

Currently, we have quite a few documents in the `engineering` repository that contain references to Kanbanize. All of them fall into the following categories:
1. Active process documentation
2. Supporting documentation
3. Historical references

As part of the migration to Linear, we're going to update only the first two categories.

#### High priority (active process documentation)

1. `13.08 Software Development Lifecycle (SDLC)` — Update `Coordination` board references
2. `31.07 Working with cards in Businessmap` — Rename and update to explain Linear workflow guidelines
3. `31.09 How to request a rollout` — Update references to Kanbanize cards
4. `teams/onboarding/README.md` — Update reference to Kanbanize for new employee onboarding

#### Medium priority (supporting documentation)

1. `13.04 Businessmap` — Archive and replace with a new document for working with Linear
2. `13.03 Steady` — Remove references to `kanbanize2statushero` integration
3. `12.02 GitHub policy` — Update rules in connection with Linear
4. `33.01 Introduction` — Update DevOps intro to use Linear instead of Kanbanize
5. `33.05 Service Delivery Review` — Archive; will be reintroduced later if necessary
6. `33.20 github-secrets-agent GitHub token` — Replace references to Kanbanize cards with Linear
7. `33.21 Database restore` — Replace mentions of Kanbanize with Linear

#### Additional changes

- The `#kanbanize` Slack channel must be archived

### Education materials

We'll educate the company in three ways:
1. A short general introduction to Linear capabilities, including a playlist of [onboarding videos](https://www.youtube.com/playlist?list=PLP9v0Y4zla9vG7k8e279bSz5hUl0oXlMH)
2. A detailed internal guide on how to use Linear to support our processes
3. A kick-off meeting with a brief introduction and Q&A session

### Expected timeline

> [!NOTE]
> All estimates are in man-days.

The whole migration process will be split into the following phases:
1. Review migration plan with SteerCo: ~1d-3d
2. Build a prototype with data migration: ~3d
3. Review migration plan with teams: ~3d-5d
4. Initial workspace setup with Business subscription to unlock major features: ~1d
5. Data migration from Kanbanize: ~1d-2d
6. Decommission of Kanbanize: ~1d
7. Update all related documentation: ~1d

**Summary**: Based on the calculated timeline, the migration will take approximately 11-14 business days to complete.
