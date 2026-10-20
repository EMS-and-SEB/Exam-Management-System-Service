# Brief Guide 

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

## Student portal accounts

Student portal accounts use the existing student-directory records. Undergraduate and graduate records remain separate accounts, including when records appear to belong to the same person. The system does not merge accounts or link them based on names or email addresses. Undergraduate self-service activation supports IDs in the `UGR/####/##` format and generates `<firstname>.ugr-####-##@aau.edu.et`, where `firstname` is the first word in the directory name. Graduate activation is managed manually by an authorized administrator.

If the institution later requires one person to access multiple academic records through a single account, that identity-linking policy must be established before account linking is implemented. Until then, each academic record is activated and authenticated independently. Portal activation does not change the existing examination-entry process, which continues to use student IDs and examination OTPs.
