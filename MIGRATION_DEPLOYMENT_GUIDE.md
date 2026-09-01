# Migration Deployment Guide

## Problem
The `user_permission_overrides` table doesn't exist in your Supabase database yet. The migration file exists but hasn't been executed.

Error: `Could not find the table 'public.user_permission_overrides' in the schema cache`

## Solution: Deploy the Migration

### Option 1: Manual SQL Execution (Quickest - 2 minutes)

1. **Go to Supabase Dashboard**
   - URL: https://app.supabase.com
   - Select your project

2. **Open SQL Editor**
   - Click the **SQL Editor** tab on the left sidebar
   - Click **New Query** button

3. **Copy and run the migration SQL**
   - Open this file: `supabase/migrations/202608310009_user_permission_overrides.sql`
   - Copy ALL the SQL code
   - Paste it into the Supabase SQL editor
   - Click **Run** button (or press Ctrl+Enter)

4. **Verify it worked**
   - You should see "Success" message
   - The table is now created and ready to use

### Option 2: Use Supabase CLI (Recommended - 3 minutes)

If you have the Supabase CLI installed:

```powershell
# Navigate to your project directory
cd d:\Projects\ERP_System

# Push all pending migrations
supabase db push
```

If you don't have Supabase CLI installed, install it first:
```powershell
# Using npm
npm install -g supabase

# Or using choco (if installed)
choco install supabase-cli
```

### Option 3: Have me do it

Tell me your Supabase project details and I can help create a setup script.

---

## What the migration creates

The migration creates:
1. **`user_permission_overrides` table** - Stores individual user permission overrides
2. **Indexes** - For fast permission lookups
3. **RLS Policies** - Security rules for row-level access control
4. **Realtime subscription** - So permission changes update instantly across all users

---

## After migration is deployed

The permission system will work like this:

### Role Defaults (Collective)
- **Owner goes to PermissionsPage → "Role Defaults" tab**
- Toggle pages ON/OFF for CASHIER role
- Affects ALL cashiers immediately (unless they have an individual override)

### Individual User Overrides
- **Owner goes to PermissionsPage → "Individual User" tab**
- Select a specific cashier
- Toggle their pages ON/OFF independently
- Their override takes precedence over role defaults
- Shows a blue "Override" badge to indicate custom settings

### Example Scenarios

**Scenario 1: Remove Dashboard for all CASHIERs**
1. Owner: PermissionsPage → "Role Defaults" tab
2. Toggle Dashboard OFF
3. All cashiers' sidebars update → Dashboard hidden

**Scenario 2: Remove Dashboard only for Cashier A**
1. Owner: PermissionsPage → "Individual User" tab
2. Select "Cashier A"
3. Toggle Dashboard OFF
4. Only Cashier A loses access (Cashier B still sees it if role default is ON)

**Scenario 3: Allow Dashboard only for Cashier B (role default is OFF)**
1. Owner: PermissionsPage → "Role Defaults" tab
2. Toggle Dashboard OFF (affects all)
3. Owner: PermissionsPage → "Individual User" tab
4. Select "Cashier B"
5. Toggle Dashboard ON (creates override)
6. Result: Cashier A can't see, Cashier B can see

---

## Troubleshooting

**"Could not find the table" error still appears**
- Refresh the page (F5)
- Clear browser cache (Ctrl+Shift+Delete)
- Try the SQL query again in Supabase SQL Editor

**Migration takes a while to run**
- Large migrations can take 30+ seconds
- Wait for the "Success" message before refreshing

**Permission changes don't apply immediately**
- Refresh the page (F5)
- The sidebar refetches every 5 seconds automatically

---

**Next Steps**
1. Choose Option 1 or 2 above to deploy the migration
2. Test the permission system:
   - Log in as Owner
   - Go to Settings → Permissions
   - Toggle Dashboard OFF in "Role Defaults" tab
   - Logout and log back in as a Cashier
   - Dashboard should be hidden from sidebar
3. Test individual overrides:
   - Use "Individual User" tab to create exceptions
   - Verify "Override" badge appears
