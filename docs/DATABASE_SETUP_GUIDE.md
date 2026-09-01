# Database Setup Guide

This document provides comprehensive instructions for setting up the mithran platform database.

## Overview

The mithran platform uses **Supabase** (PostgreSQL) as its primary database. The backend connects to Supabase using both:
- **Supabase Client SDK** - For RLS-enabled operations with user authentication
- **Direct PostgreSQL Connection** - For administrative tasks and migrations

## Prerequisites

1. **Supabase Account** - Create a free account at [supabase.com](https://supabase.com)
2. **Node.js** - Version 18 or higher
3. **Git** - For version control

## Setup Steps

### 1. Create a Supabase Project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard)
2. Click **"New Project"**
3. Fill in project details:
   - **Name**: mithran-platform (or your preferred name)
   - **Database Password**: Create a strong password (save this!)
   - **Region**: Choose closest to your users
4. Click **"Create new project"** and wait for provisioning (~2 minutes)

### 2. Get Your Supabase Credentials

Once your project is ready:

1. Go to **Project Settings** > **API**
2. Copy the following values:
   - **Project URL** (looks like: `https://xxxxx.supabase.co`)
   - **anon public key** (starts with `eyJ...`)
   - **service_role key** (starts with `eyJ...`) - ⚠️ Keep this secret!

3. Go to **Project Settings** > **Database**
4. Copy the **Connection String** from the "Connection string" section
   - Use the **Connection Pooling** version (port 6543)
   - Format: `postgresql://postgres:[password]@db.xxxxx.supabase.co:6543/postgres`

### 3. Configure Environment Variables

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```

2. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

3. Edit `.env` and update with your Supabase credentials:
   ```env
   # Environment
   NODE_ENV=development

   # Server
   PORT=4000

   # Database (from Supabase Dashboard > Settings > Database)
   DATABASE_HOST=db.xxxxx.supabase.co
   DATABASE_PORT=6543
   DATABASE_USER=postgres
   DATABASE_PASSWORD=your-database-password-here
   DATABASE_NAME=postgres
   DATABASE_SSL=true

   # Supabase (from Supabase Dashboard > Settings > API)
   SUPABASE_URL=https://xxxxx.supabase.co
   SUPABASE_ANON_KEY=your-anon-key-here
   SUPABASE_SERVICE_KEY=your-service-role-key-here

   # CORS
   CORS_ORIGIN=http://localhost:3000

   # Rate Limiting
   THROTTLE_TTL=60000
   THROTTLE_LIMIT=100

   # Logging
   LOG_LEVEL=info
   ```

### 4. Validate Environment Configuration

Run the validation script to ensure everything is configured correctly:

```bash
npm run env:validate
```

This will check:
- ✅ All required environment variables are set
- ✅ Supabase API is accessible
- ✅ PostgreSQL connection is working
- ✅ Database version and connectivity

### 5. Run Database Migrations

Create all required tables and policies:

```bash
npm run db:migrate
```

This will:
- Create a `schema_migrations` tracking table
- Execute all pending migrations in order
- Create tables: `projects`, `vendors`, `materials`, `boms`, `bom_items`
- Set up Row Level Security (RLS) policies
- Create database indexes and triggers

Expected output:
```
Starting migration process...

📊 Database: postgres
🏠 Host: db.xxxxx.supabase.co

 Found 0 previously executed migration(s)
 Found 1 total migration file(s)

⏳ Running 1 pending migration(s)...

📄 Running migration: 001_initial_schema.sql
✅ Completed: 001_initial_schema.sql

✅ All migrations completed successfully!
```

### 6. (Optional) Seed Sample Data

For development/testing, populate the database with sample data:

```bash
npm run db:seed
```

This creates:
- 3 sample vendors
- 4 sample materials
- 2 sample projects
- 2 BOMs with associated items

### 7. Verify Setup

Start the development server:

```bash
npm run start:dev
```

The application should start successfully. Check the logs for:
- ✅ Database connection successful
- ✅ All required tables found

## Database Management Scripts

The following npm scripts are available:

| Script | Description |
|--------|-------------|
| `npm run db:migrate` | Run all pending migrations |
| `npm run db:migrate:reset` | ⚠️ DROP all tables and re-run migrations (DESTRUCTIVE) |
| `npm run db:seed` | Populate database with sample data (dev only) |
| `npm run env:validate` | Validate environment configuration |

## Troubleshooting

### Error: "Could not find the table 'public.projects'"

**Cause**: Migrations haven't been run yet.

**Solution**:
```bash
npm run db:migrate
```

### Error: "Database connection failed"

**Cause**: Invalid credentials or network issue.

**Solution**:
1. Verify your `.env` file has correct Supabase credentials
2. Check your Supabase project is active (not paused)
3. Ensure your IP is allowed (Supabase allows all IPs by default)
4. Run: `npm run env:validate` to diagnose

### Error: "getaddrinfo ENOTFOUND"

**Cause**: Cannot resolve Supabase hostname.

**Solution**:
1. Check your internet connection
2. Verify `DATABASE_HOST` in `.env` is correct
3. Ensure no firewall is blocking outbound connections on port 6543

### Tables exist but queries fail with "permission denied"

**Cause**: Row Level Security (RLS) is enabled but no valid auth token.

**Solution**:
- For API requests, ensure you're passing a valid Supabase auth token
- For development, you can temporarily disable RLS (NOT recommended for production)
- The migrations create policies that require `auth.uid()` - ensure users are authenticated

## Database Schema

The platform uses the following main tables:

```
projects
├── id (uuid, PK)
├── name (varchar)
├── description (text)
├── user_id (uuid, FK -> auth.users)
├── status (enum: draft, active, completed, on_hold, cancelled)
└── timestamps

vendors
├── id (uuid, PK)
├── name (varchar)
├── contact_email (varchar)
├── user_id (uuid, FK -> auth.users)
└── timestamps

materials
├── id (uuid, PK)
├── name (varchar)
├── type (enum: raw, component, assembly)
├── unit (enum: kg, meter, piece, liter)
├── unit_cost (decimal)
├── vendor_id (uuid, FK -> vendors)
└── timestamps

boms
├── id (uuid, PK)
├── name (varchar)
├── project_id (uuid, FK -> projects)
├── user_id (uuid, FK -> auth.users)
└── timestamps

bom_items
├── id (uuid, PK)
├── bom_id (uuid, FK -> boms)
├── material_id (uuid, FK -> materials)
├── quantity (decimal)
└── timestamps
```

## Security Notes

- ⚠️ **Never commit `.env` file** - It contains sensitive credentials
- ⚠️ **Keep `SUPABASE_SERVICE_KEY` secret** - It bypasses RLS policies
- ✅ **Use `SUPABASE_ANON_KEY`** for client-side applications
- ✅ **Row Level Security (RLS)** is enabled on all tables
- ✅ **User isolation** - Each user can only access their own data

## Next Steps

After completing database setup:

1. **Set up authentication** - Configure Supabase Auth providers
2. **Test API endpoints** - Use Postman or curl to verify CRUD operations
3. **Connect frontend** - Update frontend `.env` with Supabase credentials
4. **Deploy** - Follow deployment guide for production setup

## Support

For issues or questions:
- Check [Supabase Documentation](https://supabase.com/docs)
- Review application logs: `npm run start:dev`
- Run diagnostics: `npm run env:validate`
