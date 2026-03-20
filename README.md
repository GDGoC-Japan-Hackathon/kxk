# WorldLens

**See the World. Know Your Risk.**

WorldLens is a web-based global intelligence dashboard that visualizes real-time world events, market signals, and geopolitical data on an interactive 3D globe.  
It enables users to monitor global risks, track emerging situations, and understand how global events may impact markets and portfolios.

---

## Overview

WorldLens integrates multiple real-time data sources into a unified global monitoring interface.

The platform provides:

- Real-time global event visualization
- Country-level intelligence and risk monitoring
- Market and news signal tracking
- AI-powered global analysis chat interface
- Portfolio intelligence insights

This project demonstrates a modular full-stack architecture combining a modern web frontend, a Python-based backend API, and cloud-ready infrastructure.

---

## Key Features

- Real-time global event visualization
- Interactive 3D world map (Cesium-based)
- Country intelligence dashboard
- Market and news monitoring
- Portfolio intelligence panel
- AI-powered chat and analysis interface
- Modular backend service architecture
- Cloud-ready deployment configuration

---

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
- REST API architecture

### Database

- SQLite

### Infrastructure

- Docker
- Google Cloud Run
- Shell deployment scripts

---

## System Architecture

Frontend (Next.js)
        |
        v
Backend API (Python)
        |
        v
Data Sources / Event Streams
        |
        v
Visualization (3D Globe)

---

## Repository Structure

worldlens/
├── apps/
│   ├── api/        # Python backend API
│   └── web/        # Next.js frontend
├── infra/          # Deployment and infrastructure scripts
├── scripts/        # Utility scripts
└── README.md

---

## How to Run Locally

### Backend

cd apps/api
pip install -r requirements.txt
python main.py

### Frontend

cd apps/web
npm install
npm run dev

---

## Deployment

The application is designed to be deployable to cloud environments.

Supported deployment targets:

- Google Cloud Run
- Docker container environments

Deployment scripts are available in:

infra/

---

## Purpose

This repository was developed as part of a hackathon project to demonstrate:

- Real-time global intelligence visualization
- Integrated monitoring and analysis workflows
- Scalable full-stack architecture
- Deployable cloud-native services

---

## Future Improvements

- Real-time streaming ingestion
- Advanced risk scoring models
- Persistent production database
- User authentication system
- Performance optimization and caching

