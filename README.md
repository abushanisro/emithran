# Mithran Manufacturing Platform

**Enterprise-grade Manufacturing Resource Planning and CAD Processing Platform**

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/yourusername/mithran)
[![License](https://img.shields.io/badge/license-UNLICENSED-red.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20.x-green.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-blue.svg)](https://postgresql.org)

## Overview

Mithran is a comprehensive manufacturing platform that integrates Bill of Materials (BOM) management, cost analysis, production planning, supplier evaluation, and CAD file processing into a unified system. Built with modern microservices architecture, it provides manufacturing teams with powerful tools for optimizing production workflows and cost management.

## Architecture

### System Components

- **Frontend**: Next.js 16+ with React 19, TypeScript, and Tailwind CSS
- **Backend API**: NestJS with TypeScript, PostgreSQL, and Supabase
- **CAD Engine**: Python FastAPI with OpenCascade for STEP/STL conversion
- **Database**: PostgreSQL with Supabase for authentication and real-time features
- **Infrastructure**: Docker containerization with production deployment support

### Performance Characteristics

- **API Response Time**: < 200ms for typical operations
- **CAD Processing**: 10-100MB STEP files in minutes
- **Concurrent Users**: Supports 10-100 manufacturing team members
- **Database**: Optimized for 1000s of BOM items and vendor records

## Features

### Core Manufacturing Modules

#### 📋 Bill of Materials (BOM) Management
- Hierarchical BOM structure with parent-child relationships
- STEP file integration with automatic geometric analysis
- Cost breakdown and aggregation across BOM levels
- Real-time cost tracking and updates

#### 💰 Advanced Cost Analysis
- **MHR (Machine Hour Rate) Calculator**: O(1) complexity with industry-standard formulas
- **Process Cost Engine**: Multi-stage manufacturing cost calculation
- **Raw Material Costing**: Gross/net usage with scrap recovery analysis  
- **Child Part Analysis**: Make vs buy decision support

#### 🏭 Production Planning & Execution
- Production lot creation and management
- Vendor assignment and capacity planning
- Process tracking with subtask management
- Real-time production monitoring and reporting

#### 🤝 Supplier Management
- Comprehensive vendor evaluation and scoring
- RFQ (Request for Quote) generation and tracking
- Capability-based supplier nomination
- Cost competency analysis and benchmarking

#### ⚙️ CAD File Processing
- STEP to STL conversion using OpenCascade Technology
- Mesh generation with configurable quality parameters
- Binary STL output for optimal file sizes
- Security validation and rate limiting

### Technical Features

#### 🔒 Security & Authentication
- Supabase-based authentication with JWT tokens
- Row-level security (RLS) for multi-tenant data isolation
- Rate limiting and file validation for CAD processing
- Comprehensive input validation and sanitization

#### 📊 Analytics & Reporting
- Real-time cost analysis dashboards
- Vendor performance metrics and scorecards
- Production efficiency tracking
- Export capabilities for external analysis

#### 🔄 Integration Capabilities
- RESTful API architecture for third-party integrations
- Webhook support for real-time notifications
- Excel/CSV data import and export
- Email notifications for RFQ and vendor communications

## Quick Start

### Prerequisites

- Node.js 20.x or higher
- Python 3.9+ (for CAD engine)
- PostgreSQL 16+
- Docker (optional, for containerized deployment)

### Installation

1. **Clone the repository**
```bash
git clone https://github.com/yourusername/mithran.git
cd mithran
```

2. **Install dependencies**
```bash
# Frontend
npm install

# Backend
cd backend
npm install

# CAD Engine
cd ../cad-engine
pip install -r requirements.txt
```

3. **Environment setup**
```bash
# Copy environment templates
cp .env.example .env
cp backend/.env.example backend/.env
cp cad-engine/.env.example cad-engine/.env

# Configure your database and API keys in .env files
```

4. **Database setup**
```bash
# Run migrations
cd backend
npm run db:migrate
```

5. **Start development servers**
```bash
# Terminal 1 - Frontend
npm run dev

# Terminal 2 - Backend API
cd backend
npm run start:dev

# Terminal 3 - CAD Engine
cd cad-engine
python main.py
```

## Development

### Project Structure

```
mithran/
├── app/                    # Next.js application pages
├── components/             # Reusable UI components
├── lib/                   # Client-side utilities and API hooks
├── backend/               # NestJS API server
│   ├── src/
│   │   ├── modules/       # Feature modules
│   │   └── common/        # Shared utilities
│   └── database/          # Migrations and schema
├── cad-engine/           # Python FastAPI CAD processor
├── sql/                  # Database utilities and migrations
└── docker-compose.yml    # Container orchestration
```

### API Documentation

The backend API provides comprehensive endpoints for all manufacturing operations:

- **BOM Management**: `/api/boms`, `/api/bom-items`
- **Cost Analysis**: `/api/process-costs`, `/api/raw-materials`
- **Production Planning**: `/api/production-planning`, `/api/production-entries`
- **Supplier Management**: `/api/vendors`, `/api/supplier-evaluation`
- **CAD Processing**: `http://localhost:8001/convert/step-to-stl`

### Testing

```bash
# Frontend
npm run test

# Backend
cd backend
npm run test
npm run test:e2e

# Type checking
npm run typecheck
```

### Build & Deployment

```bash
# Production build
npm run build
cd backend && npm run build

# Docker deployment
docker-compose -f docker-compose.prod.yml up -d
```

## Performance Optimization

### Algorithmic Complexity Analysis

#### Backend Cost Engines: **O(1)** - Optimally designed
- MHR calculations: Constant time mathematical operations
- Process costing: Linear formulas without loops
- Raw material analysis: Fixed computational steps

#### Production Planning: **O(n²)** - Optimization opportunities identified
- BOM processing: Scales quadratically with item count
- Vendor evaluation: Linear with proper database indexing
- Batch operations: Optimized for bulk updates

#### CAD Engine: **O(n²-n³)** - Geometry-dependent
- STEP parsing: Linear with file size
- Mesh generation: Quadratic to cubic with model complexity
- Memory usage: 20-50x input file size during processing

### Optimization Recommendations

1. **Database Query Optimization**
   - Implement proper JOINs to eliminate N+1 patterns
   - Add composite indexes on frequently queried columns
   - Use database views for complex reporting queries

2. **Caching Strategy**
   - Redis caching for frequently accessed BOM and vendor data
   - Result caching for expensive calculations
   - CDN integration for static assets

3. **Batch Processing**
   - Background jobs for heavy computational tasks
   - Bulk database operations instead of individual updates
   - Queue management for CAD file processing

## Contributing

We follow industry-standard development practices:

1. **Code Style**: ESLint + Prettier for consistent formatting
2. **Git Workflow**: Feature branches with pull request reviews
3. **Testing**: Comprehensive unit and integration tests
4. **Documentation**: Inline code documentation and API specs

### Development Workflow

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/new-feature`
3. Commit changes: `git commit -am 'Add new feature'`
4. Push to branch: `git push origin feature/new-feature`
5. Submit a pull request

## Security

### Security Measures

- **Authentication**: JWT-based with automatic token refresh
- **Authorization**: Role-based access control with RLS
- **Input Validation**: Comprehensive sanitization and type checking
- **File Upload Security**: Magic number validation and size limits
- **Rate Limiting**: API and CAD processing endpoint protection

### Vulnerability Reporting

Report security vulnerabilities to [security@mithran.com](mailto:security@mithran.com)

## Support

### Documentation

- **API Documentation**: Available at `/api/docs` when running the backend
- **Component Storybook**: `npm run storybook` (if configured)
- **Database Schema**: See `backend/database/migrations/`

### Getting Help

- **Issues**: [GitHub Issues](https://github.com/yourusername/mithran/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/mithran/discussions)
- **Email Support**: [support@mithran.com](mailto:support@mithran.com)

## License

This software is proprietary and confidential. All rights reserved.

## Acknowledgments

- **OpenCascade Technology**: CAD kernel for geometric processing
- **NestJS Framework**: Enterprise Node.js framework
- **Supabase**: Backend-as-a-Service platform
- **Radix UI**: Accessible UI component primitives

---

**Mithran Manufacturing Platform** - Built for the future of manufacturing
# Updated Wed, Feb 18, 2026  4:12:07 PM
