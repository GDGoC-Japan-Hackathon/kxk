# WorldLens
**See the World. Know Your Risk.**

WorldLens is a web-based global intelligence dashboard that visualizes real-time world events, market signals, and geopolitical data on an interactive globe.
It helps users monitor global risks and understand how events may impact markets and portfolios.

## Overview

WorldLens integrates multiple real-time data sources into a single global monitoring interface.

Users can:
- Explore real-time global events on a 3D world map
- Monitor country-level intelligence and risk signals
- Track market and news data streams
- Analyze global situations through an AI-powered chat interface
- View portfolio-related insights and reports

This project demonstrates a modular architecture combining a modern web frontend, a Python backend API, and deployable infrastructure.

## Key Features

- Real-time global event visualization
- Interactive 3D world map (Cesium-based)
- Country intelligence dashboard
- Market and news monitoring
- Portfolio intelligence panel
- AI chat / analysis interface
- Modular backend service architecture
- Cloud-ready deployment scripts

## Tech Stack

### Frontend
- Next.js
- TypeScript
- React
- Tailwind CSS
- Cesium (3D globe visualization)

### Backend
- Python
- FastAPI-style API service
- REST API endpoints

### Database
- SQLite

### Infrastructure
- Docker
- Google Cloud Run
- Shell deployment scripts

## Repository Structure

```text
worldlens/
├── apps/
│   ├── api/        # Python backend API
│   └── web/        # Next.js frontend
├── packages/       # Shared / event / risk modules
├── infra/          # Deployment and infrastructure scripts
├── scripts/        # Utility scripts
└── README.md
```
