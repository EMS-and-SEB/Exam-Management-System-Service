# Project Name

Brief description of what this backend service does.

## Prerequisites

Before you begin, ensure you have the following installed:

- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- [npm](https://www.npmjs.com/)
- A running instance of your database (PostgreSQL)
- [Git](https://git-scm.com/)

## Getting Started

Follow these steps to set up the project locally.

### 1. Clone the repository

```bash
git clone https://github.com/barakidg/Exam-Management-System-Service.git
cd Exam-Management-System-Service
```

### 2. Copy the environment file

```bash
cp .env.example .env
```

Then open `.env` and fill in the required values.

### 3. Install dependencies

```bash
npm install
```

### 4. Apply the migrations that already exist in prisma module

```bash
npx prisma generate
npx prisma migrate deploy 
```

If you need to change the schema by any means, you will have to run "migrate dev" command.

### 5. Start the development server

```bash
npm run start
```
