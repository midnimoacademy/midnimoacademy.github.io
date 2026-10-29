# Blockchain beginner track — implementation record

Implemented in this session: five lessons (25 explanation sections plus Somali summaries), five practice tasks, fifteen knowledge-check questions with feedback, optional repeat attempts, database enrolment and lesson progress, private attempt records and project notes, downloadable Solidity Counter and a standalone local interface model. Existing mandatory sign-in and learner form are preserved. Eight-faculty content was not changed.

Validation: seven core tests pass, including standard SHA-256 vectors and fallback/native equivalence; all five exercise flows and the five-of-five completion display exercised in the browser with a mock database; live PostgreSQL transaction verified own attempt insertion and blocked another learner's read/write, then rolled back. Desktop and 390-pixel iframe layout inspected. No production learner records were manufactured for testing.

Limits: browser UI testing used a mock signed-in learner, not a real production session. The Solidity source has not yet been compiled/deployed in Remix during this session. The JavaScript tools model rules only and cannot establish that a real dApp works. No real wallet integration, public-network deployment, accredited certificates or video recordings are supplied by this beginner track. Confirm the teacher, meeting link and live-class timetable separately before promising a live session date.

Learning completion is self-recorded practice, not a secure proctored assessment. Do not use the client-side scores to make admission or qualification decisions. Project notes are private to the learner under RLS. Official technical references are linked from the course.

Suggested launch review: sign in on a phone and laptop; complete the learner form if needed; save a lesson and reload on the second device; compile Counter.sol with 0.8.24 in Remix VM; test owner/non-owner reset; review lesson wording; confirm the live timetable.
