# Focus Desk

Focus Desk is a Notion-inspired personal task manager built with Next.js and Supabase, designed to deploy cleanly on Vercel. It helps you manage personal life, work, and school in one interface with email sign-in, task capture, editable task details, and status-based organization.

## Stack

- Next.js App Router
- React
- Supabase Auth + Postgres
- Vercel deployment

## Features

- Magic link email authentication with Supabase
- Tasks organized by `personal`, `work`, and `school`
- Status lanes for `backlog`, `today`, `in_progress`, and `done`
- Priority and due date tracking
- Notion-like soft panel layout with an editorial dashboard feel
- Demo mode when Supabase environment variables are missing

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Copy the environment template:

```bash
cp .env.example .env.local
```

3. In Supabase, create a new project.

4. Open Supabase and go to `SQL Editor`.

5. Paste the contents of [supabase/schema.sql](/Users/parkerrowland3/Documents/Projects/personal_management_app/supabase/schema.sql) and run it.

6. Go to `Project Settings > API` and copy:

- `Project URL`
- `anon public` key

7. Add those values to `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

8. In Supabase, go to `Authentication > URL Configuration` and set:

- `Site URL`: `http://localhost:3000`
- Add `http://localhost:3000` to redirect URLs

9. Start the app:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Supabase configuration notes

### Authentication

This app uses `signInWithOtp`, so make sure email auth is enabled:

1. Go to `Authentication > Providers`.
2. Ensure `Email` is enabled.
3. Leave magic links enabled.

### Database schema

The task table includes:

- `title`
- `description`
- `domain`
- `status`
- `priority`
- `due_date`
- `user_id`

Row level security is enabled so each authenticated user can only access their own tasks.

## Deploy to Vercel

1. Push this repo to GitHub.

2. In Vercel, create a new project and import the repository.

3. Add these environment variables in Vercel:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

4. In Supabase, update `Authentication > URL Configuration` with your production Vercel URL.

Example:

- `Site URL`: `https://your-project-name.vercel.app`
- Redirect URL: `https://your-project-name.vercel.app`

If you later attach a custom domain, add that URL too.

5. Deploy.

Vercel will run the standard Next.js build automatically.

## Recommended deployment flow

1. Create the Supabase project first.
2. Run the SQL schema.
3. Set local env vars and test locally.
4. Push to GitHub.
5. Import into Vercel.
6. Set the same env vars in Vercel.
7. Update Supabase auth redirect URLs to match production.
8. Redeploy if needed.

## Project structure

- [src/app/page.tsx](/Users/parkerrowland3/Documents/Projects/personal_management_app/src/app/page.tsx) renders the main dashboard.
- [src/components/task-shell.tsx](/Users/parkerrowland3/Documents/Projects/personal_management_app/src/components/task-shell.tsx) contains the client-side app logic and UI.
- [src/lib/supabase.ts](/Users/parkerrowland3/Documents/Projects/personal_management_app/src/lib/supabase.ts) initializes the browser Supabase client.
- [supabase/schema.sql](/Users/parkerrowland3/Documents/Projects/personal_management_app/supabase/schema.sql) defines the database schema and policies.

## Important behavior

- Without Supabase env vars, the app runs in demo mode with sample tasks.
- With Supabase configured, users sign in by email and tasks persist to Supabase.
- The UI is entirely client-side for simplicity and clean Vercel deployment.

## Commands

```bash
npm run dev
npm run build
npm run lint
```

## Next steps you may want

- Add drag-and-drop ordering
- Add recurring tasks
- Add project pages or notes
- Add calendar and week views
