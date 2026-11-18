# Scholarship Monitoring System (exam-redilla)

Files: `index.html`, `styles.css`, `app.js` (website) and `migration.sql`, `staff-setup.sql` (database).
Supabase URL at publishable key ay nakalagay na sa `app.js`.

## A. Database (Supabase)
1. Supabase -> SQL Editor -> New query -> i-paste ang buong `migration.sql` -> Run.
2. Authentication -> Users -> Add user (staff email + password, tick "Auto Confirm User"). Kopyahin ang UUID.
3. Buksan ang `staff-setup.sql`, palitan ang UUID, i-run sa SQL Editor.
4. Gumawa rin ng scholar user sa Authentication -> Users. Kopyahin ang UUID.

## B. Subukan sa computer
Double-click ang `index.html` (o gamitin ang Live Server sa VS Code). Mag-login bilang staff,
Scholar Management -> i-assign ang scholar (UUID, Student ID, pangalan, program).

## C. Ilagay sa GitHub
1. github.com -> New repository (hal. `exam-redilla`) -> Public.
2. "uploading an existing file" -> i-drag ang `index.html`, `styles.css`, `app.js`, `migration.sql`, `staff-setup.sql`, `README.md` -> Commit.
3. Settings -> Pages -> Source: Deploy from a branch -> `main` / root -> Save.
4. Hintayin ang link: `https://USERNAME.github.io/exam-redilla/`.
5. Supabase -> Authentication -> URL Configuration -> ilagay ang GitHub Pages link sa Site URL.

## Flow
Scholar: Submit Grades. Staff: Review -> Mark verified -> Save compliance evaluation -> Approve renewal.

Huwag ilalagay ang `service_role` o `sb_secret_` key sa kahit anong file.
