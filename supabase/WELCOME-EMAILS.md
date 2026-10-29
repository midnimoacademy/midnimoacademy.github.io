# Account welcome emails

The 29 October 2026 welcome batch targets existing registered email addresses from this project's auth.users roster, one message per unique normalised address. Each recipient gets an individual English message from freemidnimoacademy@gmail.com with sign-in, dashboard, Blockchain learner profile and email preference links. This account onboarding message does not subscribe anyone to optional newsletters.

welcome_email_deliveries has RLS and administrator-only read access; the service role owns sends. A unique lower(email) index plus atomic pending-to-sending claims prevent duplicate processing. Accepted records contain the Brevo message ID. Accepted is not confirmed inbox delivery; use Brevo Transactional logs for final delivery and bounce status. Failed, sending and unknown records are not retried automatically.

The welcome-email-delivery function supports administrator-authenticated summary/process requests. A temporary, narrowly scoped, expiring invocation credential used to execute the authorised first batch is removed after completion. It is not committed to this repository. BREVO_API_KEY remains in Edge Function Secrets. Future automatic registration welcomes are not configured by this implementation.

Validation: JavaScript syntax check; tests for administrator authorization, duplicate claim protection, completed queues, one-recipient message addressing, English content and provider receipt recording; live batch status checked in the database.
