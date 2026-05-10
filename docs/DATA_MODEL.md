# Data Model

## users / profiles
- id
- name
- email: internal synthetic auth email
- phone: text, optional display-only
- role: student | admin
- active: boolean
- created_at

## checkins
- id
- student_id
- date
- completed: boolean
- note: text, optional
- submitted_at
- updated_at
- updated_by_admin, optional

## Rules
- One check-in per student per date.
- Students can only view and submit their own check-ins.
- Admins can view all check-ins.
- Admins can edit/correct check-ins.
