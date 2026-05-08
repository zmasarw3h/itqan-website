# Acceptance Criteria

## Student
- Student can log in.
- Student can submit today's check-in.
- Student cannot submit duplicate check-ins for the same date.
- Student can see whether today was already submitted.
- Student can view their own history.
- Student cannot view other students.

## Admin
- Admin can log in.
- Admin can view all students.
- Admin can view check-ins by date/week.
- Admin can see completed and missing students.
- Admin can filter by student/date/status.
- Admin can manually correct a check-in.
- Admin can export CSV.
- Admin can access all student histories.

## Security
- Students cannot access admin pages.
- Students cannot edit another student’s check-in.
- Only admins can edit existing check-ins.
- Inactive users cannot use the system.

## Deployment
- App builds successfully.
- Database schema is documented.
- Environment variables are documented.
- Seed data instructions are included.