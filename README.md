# AI-Driven Hiring & Interview Automation Platform (HRMS-v1)

An enterprise-grade, automated hiring platform that streamlines recruitment workflows by integrating Applicant Tracking System (ATS) resume evaluation, a real-time conversational AI interviewer ("Alex"), and a multi-layered computer vision proctoring engine.

> [!NOTE]
> **Live Application Portal:** [hiring-interview-automation-platform-production.up.railway.app](https://hiring-interview-automation-platform-production.up.railway.app)
> 
> **Interactive Walkthrough:** [Watch the Platform Demo Video](https://drive.google.com/file/d/1lG6VlSSa4HKf5UkaFFrakJJlvdGmSyQf/view?usp=sharing)

---

## 📖 Table of Contents
1. [Product Features & User Flows](#-product-features--user-flows)
2. [System Architecture & Core Modules](#-system-architecture--core-modules)
3. [Relational Database Schema](#-relational-database-schema)
4. [API Reference Directory](#-api-reference-directory)
5. [QA & Debugging Logs](#-qa--debugging-logs)
6. [Local Development Setup](#-local-development-setup)
7. [Deployment & Production Guidelines](#-deployment--production-guidelines)

---

## 🚀 Product Features & User Flows

The platform supports two primary target audiences (Recruiters and Candidates) and integrates autonomous AI agents to manage evaluation and interview integrity:

### 💼 1. Recruiter & Administrator Portal
* **Dashboard Control:** Direct overview of active jobs, aggregate candidate application metrics, and proctoring violation alerts.
* **Job & Round Customization:** Create and configure roles, adjust ATS matching thresholds, customize candidate invitation email templates, and define targeted interview focus areas (e.g. Frontend, System Design, General Coding).
* **Detailed AI Scorecard Analytics:** View generated candidate transcripts, structured core-competency breakdown, specific strengths/weaknesses evidence, and AI recommendations.
* **Candidate Comparison Matrix:** Interactively compare multiple candidates side-by-side on technical skills, communication, and proctoring risk ratings.

### 👤 2. Candidate Portal & Dashboard
* **Job Board:** Access organization-specific job listings, review role requirements, location tags, and compensation.
* **Application Tracker:** Submit applications via PDF, DOCX, or TXT resume parsing, and track real-time hiring lifecycle status (`Applied` → `ATS Failed` → `Interview Scheduled` → `Interview In Progress` → `Interview Completed` → `Selected/Rejected`).
* **Profile Management:** Manage personal bio, github profiles, portfolio URLs, and keep resumes up to date.

### 🤖 3. Real-Time Conversational AI Interviewer ("Alex")
* **Voice-First Experience:** Dynamic web-based voice interface simulating a face-to-face screening.
* **Adaptive Prompting:** Uses stateful conversational AI nodes leveraging LLMs (OpenAI/Kimi) to adjust question difficulty dynamically according to candidate response performance.

### 🛡️ 4. Anti-Cheat & Proctoring Engine
* **Client-Side Computer Vision:** MediaPipe Vision Tasks running in-browser WebAssembly to detect:
  * *Gaze Tracking:* Triggers an alert if a candidate repeatedly turns away from the screen (modeled via BlazeFace keypoints filtered through a fast-reaction Exponential Moving Average).
  * *Phone Detection:* ObjectDetector (EfficientDet-Lite0) tracks cell phone presence.
  * *Face Counts:* Detects missing or multiple faces in the video frame.
* **Browser Sandbox Tracking:** Monitors tab switching (document visibility api), screen share terminations, and clipboard paste events.
* **Heartbeat & Event Severity Log:** Regularly transmits heartbeats and registers proctoring infractions (`flag`, `warning`, `info`) complete with base64 WebP photographic evidence.
* **Resilient Fallbacks:** Fallback to client-side canvas-based pixel-brightness block analysis when the primary ML models fail to load or initialize.

---

## ⚙️ System Architecture & Core Modules

The application is built on a custom Node.js server wrapper surrounding a Next.js framework, accommodating concurrent WebSocket connections and Next.js routing over a unified port.

### Component Interaction Flow

```mermaid
graph TD
    subgraph Client ["Candidate Browser"]
        React["Next.js React Frontend"]
        MP["MediaPipe WASM (Gaze/Phone)"]
        React -->|Video Frames| MP
    end

    subgraph Backend ["Next.js & Custom Server (server-custom.js)"]
        HttpSrv["HTTP / WebSocket Server"]
        NextApi["Next.js App API Routes"]
        STTProxy["STT WebSocket Proxy"]
        TTS["Edge-TTS (Python CLI)"]
        Parser["8-Stage Scorecard Parser"]
        
        HttpSrv -->|Standard HTTP| NextApi
        HttpSrv -->|WS Upgrade /api/stt-ws| STTProxy
        NextApi -->|Subprocess Invocation| TTS
        NextApi -->|Sanitize LLM Output| Parser
    end

    subgraph Data ["Data Storage"]
        DB[(PostgreSQL)]
    end

    subgraph ThirdParty ["External Services"]
        LLM["AI LLMs (OpenAI / Kimi)"]
        STT["STT Upstream (Soniox/Deepgram)"]
    end

    React -->|HTTP Requests| HttpSrv
    React -->|WebSocket Stream| STTProxy
    NextApi -->|Queries / Pools| DB
    STTProxy -->|Verify Session Token| DB
    NextApi -->|Analyze Resumes / Eval API Calls| LLM
    STTProxy -->|Binary Audio Frames| STT
```

### Key Modules & Algorithms

1. **Next.js WebSocket Proxy (`server-custom.js`):**
   Intercepts upgrades on `/api/stt-ws`, checks candidate tokens against PostgreSQL, connects to upstream Speech-To-Text providers (Soniox, Deepgram, or Sarvam), and statefully merges sliding-window token fragments so the Next.js frontend only consumes clean `is_final` events.
2. **Gaze EMA Filter (`Proctoring.tsx`):**
   Traces head position based on BlazeFace keypoint coordinate variances. Implements an Exponential Moving Average (EMA) ($\alpha = 0.80$, drops to $0.40$ in low-confidence lighting environments) to smooth flickering nose-to-eye coordinates and trigger alerts when the candidate focuses away for more than 1 consecutive frame (reducing calibration overhead).
3. **8-Stage AI Scorecard Repair (`src/lib/parse-scorecard.ts`):**
   Aggressively sanitizes and normalizes LLM responses to avoid parsing crashes using these fallback techniques:
   * **Stage 1:** Standard native parsing.
   * **Stage 2:** Markdown code block trimming (removal of ` ```json ` fences).
   * **Stage 3:** Depth-aware bracket tracking (extracts the first valid `{}` object block).
   * **Stage 4:** General cleaning (removing placeholder `...` ellipses and trailing commas before braces).
   * **Stage 5-6:** JSON quote translation (converting single quotes on keys and values to valid double quotes, escaping embedded quotes).
   * **Stage 7:** Bracket reconciliation (injecting missing closing brackets/braces for truncated streams).
   * **Stage 8:** Battle-tested `jsonrepair` package library fallback.

---

## 🗄️ Relational Database Schema

The relational schema is configured in PostgreSQL (14+), utilizing UUID primary keys, default indexing on search keys, and cascade rules.

```
                  +-------------------+
                  |   organizations   |
                  +---------+---------+
                            | 1
                            |
                            | 1..*
                  +---------v---------+
                  |       users       |
                  +---------+---------+
                            | 1
                            |
                            | 0..*
                  +---------v---------+
                  |       jobs        |
                  +---------+---------+
                            | 1
                            |
                            | 1..*
                  +---------v---------+          +-----------------------+
                  | job_applications  +----------+    ats_evaluations    |
                  +---------+---------+ 1      1 +-----------------------+
                            | 1
                            |
                            | 1
                  +---------v---------+          +-----------------------+
                  |  interview_tokens +----------+      interviews       |
                  +-------------------+ 1      1 +----------+------------+
                                                            | 1
                                                            |
                                           +----------------+----------------+
                                           | 1..*                            | 1..*
                                 +---------v---------+             +---------v---------+
                                 | transcript_entries|             | proctoring_events |
                                 +-------------------+             +-------------------+
```

### Table Breakdown

#### `organizations`
Defines tenant space for recruiter cohorts or candidate pools.
* `id` (UUID, Primary Key)
* `name` (VARCHAR)
* `slug` (VARCHAR, Unique)
* `logo_url` (TEXT)
* `clerk_id` (VARCHAR, Unique)
* `created_at`, `updated_at` (TIMESTAMPTZ)

#### `users`
Accounts for system administrators, interviewers, and candidates.
* `id` (UUID, Primary Key)
* `org_id` (UUID, References `organizations.id`)
* `email` (VARCHAR, Unique)
* `name` (VARCHAR)
* `password_hash` (VARCHAR)
* `role` (VARCHAR, defaults to `'interviewer'`)
* `clerk_id` (VARCHAR, Unique)
* `is_active` (BOOLEAN)
* `created_at`, `updated_at` (TIMESTAMPTZ)

#### `jobs`
Positions posted by hiring managers.
* `id` (UUID, Primary Key)
* `org_id` (UUID, References `organizations.id`)
* `title` (VARCHAR)
* `description` (TEXT)
* `requirements` (TEXT)
* `department` (VARCHAR)
* `location` (VARCHAR)
* `employment_type` (VARCHAR)
* `role_tag`, `level_tag` (VARCHAR)
* `status` (VARCHAR, defaults to `'open'`)
* `created_at`, `updated_at` (TIMESTAMPTZ)

#### `ats_evaluations`
Stores parse results and score matrices returned from parsing candidate resumes.
* `id` (UUID, Primary Key)
* `candidate_id` (UUID)
* `job_id` (UUID, References `jobs.id`)
* `resume_text` (TEXT)
* `score` (DOUBLE PRECISION)
* `label` (VARCHAR)
* `matched_skills`, `missing_skills`, `suggestions` (JSONB)
* `domain` (VARCHAR)
* `skill_coverage` (DOUBLE PRECISION)
* `explanation` (TEXT)
* `is_global` (BOOLEAN)
* `evaluation_source` (VARCHAR, defaults to `'llm'`)
* `full_result` (JSONB)
* `created_at` (TIMESTAMPTZ)

#### `interviews`
Records session metadata, metrics, and configurations for candidate assessments.
* `id` (UUID, Primary Key)
* `org_id` (UUID, References `organizations.id`)
* `created_by` (UUID, References `users.id`)
* `candidate_email`, `candidate_name`, `candidate_phone` (VARCHAR)
* `resume` (TEXT)
* `role`, `level` (VARCHAR)
* `focus_areas` (TEXT ARRAY)
* `duration` (INTEGER)
* `round_type` (VARCHAR, defaults to `'General'`)
* `round_number` (INTEGER)
* `language` (VARCHAR, defaults to `'en'`)
* `token` (VARCHAR)
* `status` (VARCHAR, defaults to `'waiting'`)
* `scorecard` (JSONB)
* `scoring_status` (VARCHAR)
* `recording_url` (TEXT)
* `last_heartbeat_at` (TIMESTAMP)
* `created_at`, `started_at`, `ended_at`, `expires_at` (TIMESTAMPTZ)

#### `proctoring_events`
Log files recording suspicious activities flags during candidate runs.
* `id` (SERIAL, Primary Key)
* `interview_id` (UUID, References `interviews.id`)
* `type` (VARCHAR: `face_missing`, `tab_switch`, `eye_away`, `multiple_faces`, `phone_detected`, `copy_paste`, etc.)
* `severity` (VARCHAR: `flag`, `warning`, `info`)
* `message` (TEXT)
* `photo` (BYTEA, contains binary WebP photos)
* `created_at` (TIMESTAMPTZ)

#### `transcript_entries`
Sequential dialog lines exchanged during the live interview sessions.
* `id` (SERIAL, Primary Key)
* `interview_id` (UUID, References `interviews.id`)
* `role` (VARCHAR: `'ai'` or `'candidate'`)
* `text` (TEXT)
* `created_at` (TIMESTAMPTZ)

#### `job_applications`
Orchestration connector linking candidates, postings, ATS scores, and interviews.
* `id` (UUID, Primary Key)
* `candidate_id` (UUID)
* `job_id` (UUID, References `jobs.id`)
* `ats_evaluation_id` (UUID, References `ats_evaluations.id`)
* `interview_token_id` (UUID, References `interview_tokens.id`)
* `status` (VARCHAR, defaults to `'applied'`)
* `applied_at`, `updated_at` (TIMESTAMPTZ)

---

## 🔌 API Reference Directory

### 👤 Candidate APIs
* `GET /api/candidate/profile` - Fetches candidate demographic info, application lists, and active resumes.
* `POST /api/candidate/profile` - Creates or updates candidate details (GitHub URL, portfolios, bio).
* `POST /api/parse-resume` - Receives PDF/DOCX files, parses text using parser libraries, and calls LLMs to extract metadata.

### 💼 Admin & Jobs APIs
* `POST /api/jobs` - Publishes a new role and matches criteria.
* `GET /api/jobs` - Retrieves open positions with filters.
* `POST /api/create-interview` - Creates interview instances and hooks token generators.
* `GET /api/interviews` - Gathers complete interviewer evaluation lists.

### 🤖 Live AI Conversational APIs
* `POST /api/ai-response` - Processes spoken/typed responses and advances conversational state.
* `POST /api/ai-speak` - Resolves responses and formats synthesized speech triggers.
* `POST /api/ai-speak-stream` - Returns server-sent events (SSE) containing real-time stream speech buffers.
* `POST /api/tts` - Internal hook directly executing the python `edge-tts` client wrapper.

### 🛡️ Live Proctoring APIs
* `POST /api/proctor-event` - Enters anti-cheat infractions, saves WebP screenshots, and files alerts.
* `POST /api/proctor-heartbeat` - Candidate-side polling to verify browser tab connectivity.

---

## 🔍 QA & Debugging Logs

The system has undergone rigorous manual and automated QA. Below is the active tracking dashboard for identified anomalies and bug statuses:

| ID | Module / Area | Summary | Severity | Status | Key Cause & Recommendation |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **BUG-001** | Candidate Portal | Resume updates fail to refresh application states. | High | ⏳ Pending | File input element does not clear; reset the `onChange` pointer and trigger state refetch on profile update. |
| **BUG-002** | Authentication | Candidate credentials are accepted via the Admin login. | Medium | ⏳ Pending | NextAuth credentials provider lacks route separation; enforce role-aware redirect filters in `middleware.ts`. |
| **BUG-003** | Resume Upload | Support for legacy `.doc` files is missing. | Medium | ⏳ Pending | Legacy format is unsupported by Next parsing tools; restrict the UI dropzone explicitly to `.docx`, `.pdf`, and `.txt`. |
| **BUG-004** | Interview Room | AI advances screen prompt while a candidate is still typing. | High | ⏳ Pending | Advance timer checks input element focus; reset and clear active advance timers during keyup events in the chatbox. |
| **BUG-005** | Interview Room | AI freezes/stops responding mid-interview. | Critical | ⏳ Pending | SSE or STT WebSocket proxy disconnection fails to clear loading states; enforce fallback alert boxes to let candidates retry. |
| **BUG-006** | Proctoring | Discrepancy between candidate infraction strike warnings and admin counts. | High | ⏳ Pending | UI strike limits don't separate raw events from strikes; consolidate strike counting constraints onto a unified DB query hook. |
| **BUG-007** | Proctoring | Missing heartbeats are flagged as cheating behavior. | Medium | ⏳ Pending | Technical disconnects write `flag` event severities; change network dropouts to `warning` severity types. |
| **BUG-008** | Screen Share | Candidate can share individual app windows instead of full screens. | High | ⏳ Pending | Frontend accepts browser surface handles; inspect `MediaStreamTrack.getSettings().displaySurface === 'monitor'` to enforce entire screen. |
| **BUG-009** | Device Precheck | No camera or mic hardware selection options. | Medium | ⏳ Pending | Browser defaults used immediately; introduce a hardware selection dropdown mapping `navigator.mediaDevices.enumerateDevices()`. |
| **BUG-010** | System / Email | Emails are not delivered. | High | ⏳ Pending | Missing SMTP variables in Dev env; implement a toast alert indicating email config status. |
| **BUG-011** | Admin Portal | "Open in Mail App" button fails. | Medium | ⏳ Pending | Mailto query strings are not URL-safe; pass arguments through `encodeURIComponent`. |
| **BUG-012** | Admin Portal | Long candidate bio overflow layout blocks. | Low | ⏳ Pending | Missing CSS wrapping properties; apply tailwind classes `break-words` and `overflow-hidden` to summary text containers. |

---

## 💻 Local Development Setup

### System Prerequisites
* **Node.js** (v18.x or above)
* **Python 3.8+** (Required for the `edge-tts` text-to-speech engine)
* **PostgreSQL 14+** (Local setup or database cloud instance)

### 🛠️ Step-by-Step Installation

1. **Clone & Install Node Packages:**
   ```bash
   npm install
   ```

2. **Configure Python Speech Engine:**
   Install the necessary text-to-speech command line module:
   ```bash
   pip install edge-tts
   ```
   *Verify execution path viability:*
   ```bash
   edge-tts --version
   ```

3. **Deploy Database Tables:**
   Execute SQL migrations consecutively inside your local database:
   ```bash
   psql -U postgres -d ai_interview_platform -f migrations/001_schema.sql
   # Execute migrations 002 through 008 in sequence
   ```

4. **Construct Environment Configuration:**
   Create a `.env.local` or `.env` inside the workspace root:
   ```env
   # Database Pool Connection
   DATABASE_URL="postgresql://postgres:password@localhost:5432/ai_interview_platform"

   # LLM Endpoint Config
   AI_BASE_URL="https://api.openai.com"
   AI_API_KEY="sk-..."
   AI_MODEL="gpt-4o"

   # Speech to Text Config (Choose one: soniox, deepgram, sarvam)
   STT_PROVIDER="soniox"
   SONIOX_API_KEY="your-soniox-key"
   STT_LANGUAGE="en-IN"

   # Authentication Settings
   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_test_..."
   CLERK_SECRET_KEY="sk_test_..."
   ```

5. **Start Dev App Instance:**
   *Important:* Use the custom server entry script to support WebSockets:
   ```bash
   node server-custom.js
   ```
   *The application will boot on `http://localhost:3000`.*

---

## 🚢 Deployment & Production Guidelines

* **WS Handshakes:** Because WebSockets are utilized on `/api/stt-ws`, reverse proxies (like Nginx, Cloudflare, or AWS ALB) must be explicitly configured to upgrade the connection protocols (`Connection: Upgrade`, `Upgrade: websocket`).
* **Docker Builds:** The production Dockerfile builds standalone assets. Trigger the container compilation using:
  ```bash
  docker build -t hiring-platform-app .
  ```
  Ensure environment values (database URLs and API keys) are passed to the container during runtimes.
* **KeepAlive Settings:** If running STT over slow proxies, ensure pings are sent within the standard 5-second window to prevent timeouts.