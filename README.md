# Lead Intake Pipeline

Lead Intake Pipeline is a lightweight web application that helps small businesses capture new sales leads through a public intake form and manage the follow-up process from a simple admin dashboard. Every submission is persisted to PostgreSQL, and staff can track lead status, log follow-up activity, and review a complete history for each lead without leaving the browser.

## Features

- Public lead intake form for capturing new prospects
- Admin dashboard with status filters and lead counts
- Expandable lead detail view for reviewing a lead at a glance
- Follow-up logging with contact method and note
- PostgreSQL persistence for leads and follow-up history

## Stack

- **Backend:** Node.js with Express
- **Database:** PostgreSQL
- **Frontend:** Vanilla HTML, CSS, and JavaScript with no build step

## Setup

1. Clone the repo:
   ```bash
   git clone https://github.com/NovaVey/lead-intake-pipeline.git
   cd lead-intake-pipeline
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Configure environment variables:
   ```bash
   cp .env.example .env
   ```
   Then edit `.env` and fill in `DATABASE_URL` for your PostgreSQL instance.
4. Initialize the database (creates the required tables):
   ```bash
   npm run db:init
   ```
5. Start the app:
   ```bash
   npm run dev
   ```
   (or `npm start` for production)

   Then open [http://localhost:3000](http://localhost:3000) in your browser.

## API Endpoints

| Method | Endpoint | Description |
| --- | --- | --- |
| GET | `/api/leads` | List all leads (supports `?status=` filter) |
| GET | `/api/leads/:id` | Get one lead with its follow-ups |
| POST | `/api/leads` | Create a new lead (`name`, `email` required) |
| PATCH | `/api/leads/:id/status` | Update a lead's status |
| POST | `/api/leads/:id/follow-ups` | Add a follow-up note to a lead |

## License

MIT © NovaVey
