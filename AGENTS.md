# Nebula workspace

At the start of work in this project, run `npm run sync:latest`. It fetches
`origin/main` and fast-forwards a clean local `main` checkout. If local edits
or another branch are present, it reports the remote state and leaves files
untouched.
