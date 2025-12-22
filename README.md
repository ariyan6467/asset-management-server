# 🛡️ Asset Management Server
> **The Secure Backbone.** A robust Node.js/Express API orchestrating asset lifecycles, Stripe payments, and multi-tenant authentication.

![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Express.js](https://img.shields.io/badge/Express.js-000000?style=for-the-badge&logo=express&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-47A248?style=for-the-badge&logo=mongodb&logoColor=white)
![Stripe](https://img.shields.io/badge/Stripe-008CDD?style=for-the-badge&logo=stripe&logoColor=white)
![Firebase](https://img.shields.io/badge/firebase-%23039BE5.svg?style=for-the-badge&logo=firebase)

---

## 📖 Introduction
The **Asset Management Server** is the central intelligence for a modern enterprise asset ecosystem. It manages complex business logic including role-based security (RBAC), Stripe-powered subscription upgrades, and real-time inventory synchronization between HR and employees.

---

## 🔥 Core Capabilities

* **🔒 Enterprise Security:** Firebase Admin SDK integration for bulletproof JWT token verification and server-side authentication.
* **💳 Monetization Engine:** Fully integrated Stripe Checkout flow for HR package upgrades with automated payment history logging.
* **📑 Asset Lifecycle:** Full CRUD operations for inventory, featuring automated stock count management during approval workflows.
* **👥 Team Orchestration:** Smart logic for HR-to-Employee affiliations, team-wide visibility, and restricted access controls.
* **🗄️ Scalable Persistence:** Structured MongoDB Atlas integration with optimized indexing across specialized collections.

---

## 🛠️ Technical Stack

* **Runtime:** Node.js (v18+)
* **Framework:** Express.js
* **Database:** MongoDB Atlas
* **Auth:** Firebase Admin SDK (Service Account)
* **Payments:** Stripe API (Checkout Sessions)
* **Encoding:** Base64 Service Account handling for secure environment portability.

---

## 🚦 Getting Started

### Prerequisites
- Node.js 18 or higher
- MongoDB Atlas Connection String
- Firebase Project & Service Account JSON
- Stripe Secret Key

### Installation
1.  **Clone the repository**
    ```bash
    git clone [https://github.com/your-username/asset-management-server.git](https://github.com/your-username/asset-management-server.git)
    cd asset-management-server
    ```
2.  **Install dependencies**
    ```bash
    npm install
    ```

### Configuration
Create a `.env` file in the root directory and fill in your credentials:
```ini
PORT=3000
DB_USER=your_mongodb_user
DB_PASS=your_mongodb_password
DB_PAYMENT_STRIPE_SECRET=sk_test_...
WEBSITE_DOMAIN=http://localhost:5173/
FIREBASE_SERVER_KER=your_base64_encoded_service_account_json
