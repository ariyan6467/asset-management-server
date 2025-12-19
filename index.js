require("dotenv").config();
const express = require("express");
const cors = require("cors");
const app = express();
const port = process.env.PORT || 3000;
const stripe = require("stripe")(process.env.DB_PAYMENT_STRIPE_SECRET);
const corsOptions = {
  origin: "http://localhost:5173", // Allow only requests from this origin
  methods: "GET,POST,PATCH,DELETE", // Allow necessary HTTP methods
};

const admin = require("firebase-admin");

const serviceAccount = require("./asset-management-firebase-adminsdk-fbsvc-bca4018068.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

app.use(cors(corsOptions));
app.use(express.json());
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const verifyFbToken = async (req, res, next) => {
  const token = req.headers.authorization;
  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }

  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    console.log("decoded token", decoded);
    req.decoded_email = decoded.email;
    next();
  } catch (err) {
    return res.send({ message: "unauthorized access" });
  }
};

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
    const paymentCollection = db.collection("payment_collection");
    const affiliationCollection = db.collection("employee_affiliation");
    const assignedAssetCollection = db.collection("employee_assigned_asset");
    //verify token

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;
      const filter = { email };
      const user = await userCollection.findOne(filter);
      if (!user || user?.userRole !== "HR Manager") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };
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
      const amount = parseInt(paymentInfo.price) * 100;
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

          //prevent duplicate
          const transactionId = session.payment_intent;
          const query = { transactionId: transactionId };
          const paymentExist = await paymentCollection.findOne(query);
          if (paymentExist) {
            return res.send({ message: "payment already done", transactionId });
          }
          const result = await userCollection.updateOne(filter, update);

          //create payment history
          const paymentHistory = {
            hrEmail: session.customer_email,
            packageName: session.metadata.name,
            employeeLimit: session.metadata.employeeLimit,
            amount: session.amount_total,
            transactionId: session.payment_intent,
            paymentDate: new Date(),
            status: session.payment_status,
          };

          const resultPayment = await paymentCollection.insertOne(
            paymentHistory
          );

          return res.send({ success: true, result, resultPayment });
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
        // if (userExist) {
        //   return res.status(400).send({ message: "product already exists" });
        // }
        const result = await assetCollection.insertOne(asset);
        return res.status(201).send(asset);
      } catch (error) {
        console.error("Error inserting user:", error); // Log the error for debugging
        return res.status(500).send({ message: "Internal Server Error" });
      }
    });

    //get asset from asset collection
    app.get("/asset-list", async (req, res) => {
      console.log("headers", req.headers);
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
    app.get("/all-request/:email", async (req, res) => {
      const request = req.body;
      const email = req.params.email;
      // if (email !== req.decoded_email) {
      //   return res.status(403).send({ message: "forbidden" });
      // }
      const filter = { hrEmail: email };
      const result = await requestCollection
        .find(filter)
        .sort({ requestDate: -1 })
        .toArray();
      res.send(result);
    });
    //get use by role
    app.get("/user-role/:email/role", async (req, res) => {
      const request = req.body;
      const email = req.params.email;

      const filter = { email: email };
      const user = await userCollection.findOne(filter);

      res.send({ role: user?.role });
    });

    //request update
    app.patch("/update-request/:id", async (req, res) => {
      const id = req.params.id;
      const assetId = req.body.assetId;
      const requestStatus = req.body.requestStatus;
      const filter = { _id: new ObjectId(id) };
     let secResult = null;
      const updateDocs = {
        $set: {
          requestStatus: requestStatus,
        },
      };

      const result = await requestCollection.updateOne(filter, updateDocs);

      if (requestStatus === "approved") {
        const assetId = req.body.assetId;
        if (!assetId) {
          return res.status(400).send({ message: "Asset ID is required" });
        }

        try {
          const objectId = new ObjectId(assetId);
          const secFilter = { _id: objectId };
         
         
         
         
          // Ensure the availableQuantity is a number before performing the increment
          const asset = await assetCollection.findOne(secFilter);
          // console.log("asset found", asset);
          if (asset) {
            const availableQuantity = parseInt(asset.availableQuantity, 10); // Convert to integer
            if (isNaN(availableQuantity)) {
              return res
                .status(400)
                .send({ message: "Invalid availableQuantity" });
            }

            const secUpdateDocs = {
              $set: { availableQuantity: availableQuantity - 1 }, // Decrease the quantity by 1
            };

            secResult = await assetCollection.updateOne(
              secFilter,
              secUpdateDocs
            );
          //  console.log("Asset updated successfully:", secResult);
            // res.send({ message: "Asset updated successfully", secResult });
          } else {
            return res.status(404).send({ message: "Asset not found" });
          }
        } catch (err) {
          console.error("Error updating asset:", err);
          return res.status(500).send({ message: "Error updating asset" });
        }
         const employeeEmail = req.body.employeeEmail;
         const employeeFilter = { employeeEmail: employeeEmail };
          const employeeExist = await affiliationCollection.findOne(
            employeeFilter
          );
        //add to affiliation list
        
 console.log("nahian");
    //add to employee asset  list
        const assignedAssetData = {
          employeeEmail: req.body.employeeEmail,
          employeeName: req.body.employeeName,
          hrEmail: req.body.hrEmail,
          companyName: req.body.companyName,
          assetId: assetId,
          assetName: req.body.assetName,
          assignedDate: new Date(),
          status: "assigned",
          assetType: req.body.assetType,
          returnDate: null,
          companyLogo: req.body.companyLogo,
          productImage: req.body.productImage,
          requestDate: req.body.requestDate,
          
        };
        const assignedAssetResult = await assignedAssetCollection.insertOne(
          assignedAssetData
        );
      if (employeeExist) {
            //  res.status(400).send({
            //   message: "Employee email already exists in our affiliation list",
             
            // });

            return res.send(result,{ message: "Asset updated successfully", secResult });
          } else {
            const affiliationData = {
              employeeEmail: req.body.employeeEmail,
              employeeName: req.body.employeeName,
              hrEmail: req.body.hrEmail,
              companyName: req.body.companyName,
              affiliationDate: new Date(),
              status: "active",
               companyLogo: req.body.companyLogo,
            };
            const affiliationResult = await affiliationCollection.insertOne(
              affiliationData
            );
          }
      }

      res.send(result,{ message: "Asset updated successfully", secResult });
    });


     //get current user assigned asset
     app.get("/assigned-asset/:employeeEmail", async (req, res) => {
      const employeeEmail = req.params.employeeEmail;
      const filter = { employeeEmail };
      const result = await assignedAssetCollection
        .find(filter)
        .sort({ assignedDate: -1 })
        .toArray();
      res.send(result);
    });


    //My Team assigned asset
    app.get("/my-team", async (req, res) => {
     
      const result = await affiliationCollection
        .find()
        .sort({ affiliationDate: -1 })
        .toArray();
      res.send(result);
    });

  
  //my employee 
    app.get("/employee/:hrEmail", async (req, res) => {
      const hrEmail = req.params.hrEmail;
      const filter = { hrEmail };
      const result = await affiliationCollection
        .find(filter)
        .sort({ affiliationDate: -1 })
        .toArray();
      res.send(result);
    });

  //remove employee from affiliation
    app.delete("/remove-employee/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const result = await affiliationCollection.deleteOne(filter);
        
        if (result.deletedCount === 1) {
          return res.status(200).send({ 
            success: true, 
            message: "Employee removed successfully",
            deletedCount: result.deletedCount 
          });
        } else {
          return res.status(404).send({ 
            success: false, 
            message: "Employee not found",
            deletedCount: result.deletedCount 
          });
        }
      } catch (error) {
        console.error("Error deleting employee:", error);
        return res.status(500).send({ 
          success: false, 
          message: "Internal server error" 
        });
      }
    });

    //get all assets for pie chart
    app.get("/all-assets", async (req, res) => {
      const result = await assetCollection.find().toArray();
      res.send(result);
    });

    //get all requests for bar chart
    app.get("/all-requests", async (req, res) => {
      const result = await requestCollection.find().toArray();
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
  res.send(" World!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
