# Studyspace

A responsive study planner built with HTML, CSS, and vanilla JavaScript, backed by a Python/Flask JSON API and SQLite database.

## Run locally

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Open [Studyspace](http://studyspace.localhost:5050). The app opens with a short entrance animation and honors your device’s reduced-motion setting. Set `DATABASE_PATH` to choose a different SQLite file. The default is `study_planner.db` in the project directory. If port 5050 is unavailable, use the port printed when you start the app.

## Features

- Assignment due dates, course links, planned study time, status, and start/pause time tracking
- Course records with codes, instructor names, and color labels
- Saved and editable course-linked notes
- Keyboard-friendly calculator with parentheses and basic arithmetic
- Coordinate graph with plotted points and lines in the form `y = mx + b`
- Buddy, a student-focused chat assistant powered by a local Ollama vision model
- Responsive layout for desktop and mobile

## Buddy (local AI, no cloud API key)

Install [Ollama](https://ollama.com/download), then download the default vision model:

```bash
ollama pull llama3.2-vision
```

Start Ollama (the desktop app, or `ollama serve`) and the Studyspace Flask app on the same computer. Open **Buddy** in the sidebar to ask questions or attach a PNG/JPEG image (up to 5 MB). Chats and uploaded images are sent only to the Ollama instance configured for this app; they are not sent to a cloud AI provider.

The defaults are `OLLAMA_BASE_URL=http://localhost:11434` and `OLLAMA_MODEL=llama3.2-vision`. Override either environment variable to use a different local Ollama address or installed vision model. Buddy is only available when the Flask app can reach that Ollama instance; the included Render deployment does not run Ollama for you.

## Deploy on Render

The included `render.yaml` defines the Flask web service, installs `requirements.txt`, binds to Render’s assigned port, and mounts a persistent disk for the SQLite database. Create a Blueprint from this repository in Render to deploy it; Render will provide the public URL after deployment.
