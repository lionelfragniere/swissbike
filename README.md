# SwissBike (NO-BUILD, single Cloud Run service)

This version removes Vite/React build completely to avoid blank-page/buildpack issues.
Frontend is plain HTML/JS served from FastAPI at `/`.

- Frontend: `/`
- API: `/api/...`

## Deploy
```bash
PROJECT_ID=swissbike
REGION=europe-west6
gcloud config set project $PROJECT_ID

gcloud run deploy swissbike-app   --source .   --region $REGION   --allow-unauthenticated
```

## Test
```bash
APP_URL=$(gcloud run services describe swissbike-app --region $REGION --format='value(status.url)')
curl -sS "$APP_URL/api/health"
```


## v3.0.0
- Multi-waypoint routing: Ctrl+Click adds via points, sent to backend as waypoints[]
- GPX import: upload GPX to /api/gpx/profile to compute elevation/slope/surface profile
- Profile chart: always distance vs elevation background by surface; hover shows slope + surface


## v3.0.2
- Cloud Run startup fix: Dockerfile now uses requirements.txt (no editable install) and python -m uvicorn


## v3.0.4
- Fix: import haversine_m (route profile distance computation)
