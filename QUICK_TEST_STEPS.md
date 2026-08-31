# Quick Test - 5 Minutes

## Start Here (Localhost)

### Step 1: Start Development Server
```bash
cd d:\Projects\ERP_System
npm run dev
```

Open browser → `http://localhost:5173`

### Step 2: Login
- Email: `ahmed@kiryanastore.com` or `usman@kiryanastore.com`
- Password: Your password

### Step 3: Go to Employees Page
- Click **Employees** in sidebar
- Should see:
  - Ahmed Khan (Owner)
  - Usman Raza (Cashier)

### Step 4: Test Invite (ONLINE)
1. Click **"Invite Employee"**
2. Fill:
   - Full Name: "Test Cashier"
   - Email: "testcashier@kiryanastore.com"
3. Click **"Create Cashier"**
4. **VERIFY**: 
   - ✅ Credentials modal shows
   - ✅ No page redirect
   - ✅ After clicking "Done", new cashier appears in list

### Step 5: Test Offline (CACHE CHECK)

1. Open DevTools (F12)
2. Go to **Application** tab
3. Left sidebar → **Cache Storage**
4. You should see a cache named something like `erp-offline-cache`
5. Click it to see what's cached

**What should be cached:**
- Products
- Categories  
- Stock data
- Previous queries

### Step 6: Test Offline Mode
1. Go to **Network** tab
2. Check the **"Offline"** checkbox at the top
3. Try these:
   - ✅ Can see Employees (cached)
   - ✅ Can see Products (cached)
   - ❌ Cannot create new item (needs internet)
4. Uncheck "Offline" to go back online

---

## Expected Results

### ✅ Good Signs
- Employees page shows both Ahmed and Usman
- Invite form doesn't redirect
- New cashier appears after invite
- DevTools shows cache is working
- Offline mode doesn't crash app

### ❌ Bad Signs
- Employees page is empty
- Error in console: "column email does not exist"
- Invite redirects to another page
- New cashier doesn't appear
- Service worker not installed

---

## If Something Breaks

### Error: "column email does not exist"
**Fix**: Run this in Supabase SQL Editor:
```sql
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email text;
UPDATE public.profiles p SET email = au.email FROM auth.users au WHERE p.id = au.id;
```

### Employees not showing
**Fix**: 
1. Hard refresh: `Ctrl+Shift+R`
2. Check browser console (F12 → Console)
3. Look for red errors

### Cache not working
**Fix**:
1. Clear cache: DevTools → Application → Clear site data
2. Refresh page
3. Should rebuild cache

---

## Next Steps After Testing

### If Everything Works Locally ✅
```bash
npm run build
git add .
git commit -m "Fix employee visibility and add offline support"
git push origin main
# Deploys to Vercel automatically
```

### Test on Vercel
- Go to your Vercel URL
- Repeat the same tests
- Check DevTools on production

---

## Testing Checklist

- [ ] Employees page shows Ahmed + Usman
- [ ] Can invite new cashier without page redirect
- [ ] New cashier appears in list
- [ ] Cache Storage has data
- [ ] Offline mode works (viewing data)
- [ ] No red errors in console
- [ ] Products page works
- [ ] Stock page works

Once all ✅, you're ready to deploy!
