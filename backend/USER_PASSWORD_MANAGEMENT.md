# User & Password Management Guide

## Overview

Passwords in the Attendance Tracker are stored as **bcrypt hashes** in PostgreSQL.
There is no way to "view" a plain-text password — bcrypt is a one-way hash.
You can only **verify** if a password matches, or **reset** it to a new value.

All user management is done via `manage.py` in the `backend/` directory.

---

## Where Passwords Live

| Layer | Location | Format |
|---|---|---|
| Database Table | `users.password_hash` column in PostgreSQL | bcrypt hash (e.g. `$2b$12$...`) |
| Code | `backend/app/core/security.py` | `get_password_hash()` / `verify_password()` |
| CLI Tool | `backend/manage.py` | All commands below |

> **IMPORTANT**: The database stores ONLY the bcrypt hash, never the plain-text password.
> Even a database admin cannot read the original password from the hash.

---

## How to Run Commands

### If backend runs in Docker (current setup)

```powershell
docker exec -it attendance_backend python manage.py <command> [options]
```

### If backend runs on host (local development)

```powershell
cd d:\ML\attendance_tracker\backend
.\venv\Scripts\activate
python manage.py <command> [options]
```

---

## Available Commands

### 1. List All Users

Shows all users, their roles, and active status. **Does NOT show passwords.**

```powershell
# Docker
docker exec -it attendance_backend python manage.py list_users

# Host
python manage.py list_users
```

**Example output:**
```
USERNAME             ROLE            ACTIVE   USER ID
--------------------------------------------------------------------------------
admin                super_admin     Yes      a1b2c3d4-...
john                 employee        Yes      e5f6g7h8-...

Total: 2 user(s)
```

---

### 2. Verify a Password (check if correct)

Tests whether a given password matches the stored hash — without changing anything.

```powershell
# Docker
docker exec -it attendance_backend python manage.py verify_password --username admin --password admin123

# Host
python manage.py verify_password --username admin --password admin123
```

**Output:**
```
[OK] Password is CORRECT for user 'admin'.
```
or
```
[FAIL] Password is INCORRECT for user 'admin'.
```

---

### 3. Change Password

Resets the password for any existing user.

```powershell
# Docker
docker exec -it attendance_backend python manage.py change_password --username admin --password MyNewSecurePass456

# Host
python manage.py change_password --username admin --password MyNewSecurePass456
```

**Output:**
```
[OK] Password changed for user 'admin' (role: super_admin).
     Timestamp: 2026-08-26T18:15:00+00:00
```

---

### 4. Interactive Password Reset

Prompts for username and password (password input is hidden). Useful to avoid
leaving passwords in shell history.

```powershell
# Docker (needs -it for interactive input)
docker exec -it attendance_backend python manage.py reset_password

# Host
python manage.py reset_password
```

**Prompts:**
```
Enter username: admin
Enter new password: ********
Confirm new password: ********
[OK] Password changed for user 'admin' (role: super_admin).
```

---

### 5. Create / Reset Super Admin

Creates a new super_admin user, or resets an existing user's password and promotes
them to super_admin.

```powershell
# Docker
docker exec -it attendance_backend python manage.py create_superadmin --username admin --password admin123

# Host
python manage.py create_superadmin --username admin --password admin123
```

If `--username` and `--password` are omitted, defaults to `admin` / `admin123`.

---

## Password Change Log

> Track all manual password changes here for audit purposes.
> Add a new entry each time you run `change_password` or `create_superadmin`.

| Date (IST) | User | Action | Changed By | Notes |
|---|---|---|---|---|
| 2026-07-25 | `admin` | Created super_admin | System (initial setup) | Default password: `admin123` |
| | | | | |

### How to add an entry

After every password change, add a row to the table above with:
- **Date**: When the change was made
- **User**: Which username was changed
- **Action**: `Password changed` / `Created super_admin` / `Role updated`
- **Changed By**: Who performed the change
- **Notes**: Any context (e.g., "forgot password", "routine rotation")

---

## Security Notes

1. **Never commit real passwords** to git. This README logs *that* a change happened, not *what* the password is.
2. **bcrypt** automatically salts each hash — two users with the same password will have different hashes.
3. **Shell history**: If you pass `--password` on the command line, it may be saved in your shell history. Use `reset_password` (interactive mode) to avoid this.
4. **JWT tokens** expire after 480 minutes (8 hours) by default. Changing a password does NOT invalidate existing tokens — the user must re-login.

---

## Quick Reference

```powershell
# See all users
docker exec -it attendance_backend python manage.py list_users

# Check if you know the right password
docker exec -it attendance_backend python manage.py verify_password --username admin --password admin123

# Change password
docker exec -it attendance_backend python manage.py change_password --username admin --password NewPass123

# Interactive reset (hides password input)
docker exec -it attendance_backend python manage.py reset_password

# Create/reset super admin with defaults
docker exec -it attendance_backend python manage.py create_superadmin
```
