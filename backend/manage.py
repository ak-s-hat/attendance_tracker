"""CLI management tool for Attendance Tracker backend."""

import argparse
import asyncio
import sys
from datetime import datetime, timezone
from pathlib import Path

# Fix Windows console UTF-8 output
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

# Add backend directory to sys.path
backend_dir = Path(__file__).resolve().parent
sys.path.insert(0, str(backend_dir))

from sqlalchemy import select
from app.core.database import AsyncSessionLocal, create_all_tables
from app.core.security import get_password_hash, verify_password
from app.models.user import User


async def create_superadmin(username: str, password: str, create_tables: bool = True):
    """Create or update a super_admin user record in PostgreSQL."""
    if create_tables:
        try:
            await create_all_tables()
        except Exception as e:
            print(f"Warning: create_all_tables warning: {e}")

    async with AsyncSessionLocal() as db:
        stmt = select(User).where(User.username == username)
        res = await db.execute(stmt)
        user = res.scalar_one_or_none()

        if user:
            user.role = "super_admin"
            user.password_hash = get_password_hash(password)
            user.is_active = True
            await db.commit()
            print(f"[OK] Successfully updated existing user '{username}' to super_admin.")
        else:
            user = User(
                username=username,
                password_hash=get_password_hash(password),
                role="super_admin",
                is_active=True,
            )
            db.add(user)
            await db.commit()
            print(f"[OK] Successfully created new super_admin user '{username}'.")


async def change_password(username: str, new_password: str):
    """Change the password for an existing user."""
    async with AsyncSessionLocal() as db:
        stmt = select(User).where(User.username == username)
        res = await db.execute(stmt)
        user = res.scalar_one_or_none()

        if not user:
            print(f"[ERROR] User '{username}' not found.")
            sys.exit(1)

        user.password_hash = get_password_hash(new_password)
        await db.commit()
        print(f"[OK] Password changed for user '{username}' (role: {user.role}).")
        print(f"     Timestamp: {datetime.now(timezone.utc).isoformat()}")


async def verify_user_password(username: str, password: str):
    """Verify whether a password matches for a given user."""
    async with AsyncSessionLocal() as db:
        stmt = select(User).where(User.username == username)
        res = await db.execute(stmt)
        user = res.scalar_one_or_none()

        if not user:
            print(f"[ERROR] User '{username}' not found.")
            sys.exit(1)

        if verify_password(password, user.password_hash):
            print(f"[OK] Password is CORRECT for user '{username}'.")
        else:
            print(f"[FAIL] Password is INCORRECT for user '{username}'.")


async def list_users():
    """List all user accounts with their roles and status."""
    async with AsyncSessionLocal() as db:
        stmt = select(User).order_by(User.role, User.username)
        res = await db.execute(stmt)
        users = res.scalars().all()

        if not users:
            print("[INFO] No users found in the database.")
            return

        print(f"\n{'USERNAME':<20} {'ROLE':<15} {'ACTIVE':<8} {'USER ID'}")
        print("-" * 80)
        for u in users:
            active_str = "Yes" if u.is_active else "No"
            print(f"{u.username:<20} {u.role:<15} {active_str:<8} {u.id}")
        print(f"\nTotal: {len(users)} user(s)")


async def reset_password_interactive():
    """Interactive password reset — prompts for username and new password."""
    import getpass
    username = input("Enter username: ").strip()
    if not username:
        print("[ERROR] Username cannot be empty.")
        sys.exit(1)
    new_password = getpass.getpass("Enter new password: ").strip()
    if not new_password:
        print("[ERROR] Password cannot be empty.")
        sys.exit(1)
    confirm = getpass.getpass("Confirm new password: ").strip()
    if new_password != confirm:
        print("[ERROR] Passwords do not match.")
        sys.exit(1)
    await change_password(username, new_password)


def main():
    parser = argparse.ArgumentParser(description="Attendance Tracker CLI Manager")
    subparsers = parser.add_subparsers(dest="command")

    # create_superadmin command
    sa_parser = subparsers.add_parser(
        "create_superadmin", help="Create or promote a super_admin user"
    )
    sa_parser.add_argument(
        "--username", default=None, help="Super admin username (default: admin)"
    )
    sa_parser.add_argument(
        "--password", default=None, help="Super admin password (default: admin123)"
    )

    # change_password command
    cp_parser = subparsers.add_parser(
        "change_password", help="Change password for an existing user"
    )
    cp_parser.add_argument(
        "--username", required=True, help="Username whose password to change"
    )
    cp_parser.add_argument(
        "--password", required=True, help="New password"
    )

    # verify_password command
    vp_parser = subparsers.add_parser(
        "verify_password", help="Check if a password is correct for a user"
    )
    vp_parser.add_argument(
        "--username", required=True, help="Username to verify"
    )
    vp_parser.add_argument(
        "--password", required=True, help="Password to check"
    )

    # list_users command
    subparsers.add_parser("list_users", help="List all users with roles")

    # reset_password (interactive) command
    subparsers.add_parser(
        "reset_password", help="Interactive password reset (prompts for input)"
    )

    args = parser.parse_args()

    # Legacy fallback for old-style invocation
    command = args.command
    if not command and len(sys.argv) > 1 and (
        "create_superadmin" in sys.argv or "--username" in sys.argv
    ):
        command = "create_superadmin"

    if command == "create_superadmin":
        username = args.username or "admin"
        password = args.password or "admin123"
        asyncio.run(create_superadmin(username, password))
    elif command == "change_password":
        asyncio.run(change_password(args.username, args.password))
    elif command == "verify_password":
        asyncio.run(verify_user_password(args.username, args.password))
    elif command == "list_users":
        asyncio.run(list_users())
    elif command == "reset_password":
        asyncio.run(reset_password_interactive())
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
