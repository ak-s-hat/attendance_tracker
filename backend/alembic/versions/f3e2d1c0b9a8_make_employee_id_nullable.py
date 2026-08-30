"""make_employee_id_nullable

Revision ID: f3e2d1c0b9a8
Revises: 3283a03dd88c
Create Date: 2026-07-25 14:32:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f3e2d1c0b9a8'
down_revision: Union[str, Sequence[str], None] = '3283a03dd88c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('attendance_logs', 'employee_id',
               existing_type=sa.UUID(),
               nullable=True)


def downgrade() -> None:
    op.alter_column('attendance_logs', 'employee_id',
               existing_type=sa.UUID(),
               nullable=False)
