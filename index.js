require("dotenv").config();
const express = require("express");
const cors = require("cors");
const app = express();
const port = process.env.PORT || 3000;
const stripe = require("stripe")(process.env.DB_PAYMENT_STRIPE_SECRET);
const corsOptions = {
  origin: "http://localhost:5173", // Allow only requests from this origin
  methods: "GET,POST,PATCH", // Allow necessary HTTP methods
};

app.use(cors(corsOptions));
app.use(express.json());
const { MongoClient, ServerApiVersion } = require("mongodb");

// Check if environment variables are set
if (!process.env.DB_USER || !process.env.DB_PASS) {
  console.error(
    "Error: DB_USER and DB_PASS environment variables are required!"
  );
  console.error("Please create a .env file with your MongoDB credentials.");
  process.exit(1);
}

// URL encode the password to handle special characters
const encodedPassword = encodeURIComponent(process.env.DB_PASS);
const uri = `mongodb+srv://${process.env.DB_USER}:${encodedPassword}@cluster0.5fch5ts.mongodb.net/asset_management_db?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    const db = client.db("asset_management_db");
    const userCollection = db.collection("users");
    const packageCollection = db.collection("package_collection");
    const assetCollection = db.collection("asset_collection");
    const requestCollection = db.collection("request_collection");

    // user handling Api's
    app.post("/users", async (req, res) => {
      const user = req.body;
      try {
        user.createdAt = new Date();
        const email = user.email;
        const userExist = await userCollection.findOne({ email });
        if (userExist) {
          return res.status(400).send({ message: "User already exists" });
        }
        const result = await userCollection.insertOne(user);
        return res.status(201).send(result);
      } catch (error) {
        console.error("Error inserting user:", error); // Log the error for debugging
        return res.status(500).send({ message: "Internal Server Error" });
      }
    });

    //get all package collection
    app.get("/packages", async (req, res) => {
      const result = await packageCollection
        .find()
        .sort({ employeeLimit: -1 })
        .toArray();
      res.send(result);
    });

    //STRIPE PAYMENT RELATED API

    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.price) * 120;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "USD",
              unit_amount: amount,
              product_data: {
                name: paymentInfo.packageName,
              },
            },
            quantity: 1,
          },
        ],
        customer_email: paymentInfo.email,

        mode: "payment",
        metadata: {
          employeeLimit: paymentInfo.employeeLimit,
          name: paymentInfo.packageName,
        },

        success_url: `${process.env.WEBSITE_DOMAIN}dashboard/package-payment-successful?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.WEBSITE_DOMAIN}dashboard/package-payment-declined`,
      });

      console.log("session:", session);
      res.send({ url: session.url });
    });
    //after payment success what i wanna  update
    app.patch("/package-payment-successful", async (req, res) => {
      try {
        const sessionId = req.query.session_id;
        if (!sessionId) {
          return res
            .status(400)
            .send({ success: false, message: "session_id is required" });
        }

        // Retrieve the Stripe session
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        if (!session || !session.metadata || !session.customer_email) {
          return res
            .status(400)
            .send({ success: false, message: "Invalid session data" });
        }

        console.log("session retrieved", session);

        if (session.payment_status === "paid") {
          const email = session.customer_email;
          const filter = { email };

          // Fetch the user's current data to get the existing packageLimit
          const user = await userCollection.findOne(filter);
          if (!user) {
            return res
              .status(404)
              .send({ success: false, message: "User not found" });
          }

          // Get the current packageLimit (if it exists), default to 0 if not
          const currentPackageLimit = user.packageLimit || 0;
          const additionalPackageLimit = session.metadata.employeeLimit || 0;
          const UpdatedPlan = session.metadata.name || "Basic";

          // Calculate the new packageLimit
          const newPackageLimit =
            parseInt(currentPackageLimit) + parseInt(additionalPackageLimit);

          // Update the user document with the new packageLimit
          const update = {
            $set: {
              packageLimit: newPackageLimit,

              subscription: session.metadata.name,
            },
          };

          const result = await userCollection.updateOne(filter, update);
          return res.send({ success: true, result });
        }

        res.send({ success: false });
      } catch (error) {
        console.error("Error processing payment:", error);
        res
          .status(500)
          .send({ success: false, message: "Internal Server Error" });
      }
    });

    //add asset to asset collection
    app.post("/add-asset", async (req, res) => {
      const asset = req.body;
      try {
        asset.dataAdded = new Date();
        const productName = asset.productName;
        const userExist = await assetCollection.findOne({ productName });
        if (userExist) {
          return res.status(400).send({ message: "product already exists" });
        }
        const result = await assetCollection.insertOne(asset);
        return res.status(201).send(asset);
      } catch (error) {
        console.error("Error inserting user:", error); // Log the error for debugging
        return res.status(500).send({ message: "Internal Server Error" });
      }
    });

    //get asset from asset collection
    app.get("/asset-list", async (req, res) => {
      const result = await assetCollection
        .find()
        .sort({
          dataAdded: -1,
        })
        .toArray();
      res.send(result);
    });

    //submit request into request collection
    app.post("/add-request", async (req, res) => {
      const request = req.body;
      try {
        request.requestDate = new Date();
        request.approvalDate = null;
        request.requestStatus = "pending";
        request.note = "Please wait ,HR will approve soon";

        const result = await requestCollection.insertOne(request);
        return res.status(201).send(request);
      } catch (error) {
        console.error("Error inserting user:", error); // Log the error for debugging
        return res.status(500).send({ message: "Internal Server Error" });
      }
    });

    //get requested data
    app.get("/all-request", async (req, res) => {
      const result = await requestCollection.find().sort({ requestDate:-1}).toArray();
      res.send(result);
    });

    app.listen(4242, () => console.log("Running on port 4242"));

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
