require("dotenv").config();

const path = require("path");
const http = require("http");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");
const { supabase } = require("./supabase");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

const PORT = process.env.PORT || 3000;
const DEFAULT_STREAMER = process.env.STREAMER_USERNAME || "streamer";

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "overlay.html"));
});

app.get("/overlay.html", (_req, res) => {
  res.sendFile(path.join(__dirname, "overlay.html"));
});

app.get("/dashboard", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

async function getOrCreateUser(username, role) {
  const { data: existing, error: selectError } = await supabase
    .from("users")
    .select("id, username, role")
    .eq("username", username)
    .maybeSingle();

  if (selectError) throw selectError;
  if (existing) return existing;

  const { data, error } = await supabase
    .from("users")
    .insert({ username, display_name: username, role })
    .select("id, username, role")
    .single();

  if (error?.code === "23505") {
    const { data: retry, error: retryError } = await supabase
      .from("users")
      .select("id, username, role")
      .eq("username", username)
      .single();
    if (retryError) throw retryError;
    return retry;
  }

  if (error) throw error;
  return data;
}

async function getOrCreateGift(name, videoUrl) {
  const { data: existing, error: selectError } = await supabase
    .from("gifts")
    .select("id, name, video_url")
    .eq("name", name)
    .maybeSingle();

  if (selectError) throw selectError;
  if (existing) return existing;

  const { data, error } = await supabase
    .from("gifts")
    .insert({ name, video_url: videoUrl })
    .select("id, name, video_url")
    .single();

  if (error?.code === "23505") {
    const { data: retry, error: retryError } = await supabase
      .from("gifts")
      .select("id, name, video_url")
      .eq("name", name)
      .single();
    if (retryError) throw retryError;
    return retry;
  }

  if (error) throw error;
  return data;
}

app.post("/api/donar", async (req, res) => {
  const { donorName, giftName, videoUrl, streamerName } = req.body || {};

  if (!donorName || !giftName || !videoUrl) {
    return res.status(400).json({
      ok: false,
      error: "Faltan donorName, giftName o videoUrl",
    });
  }

  const donorUsername = String(donorName).trim();
  const giftLabel = String(giftName).trim();
  const streamerUsername = String(streamerName || DEFAULT_STREAMER).trim();

  if (donorUsername.toLowerCase() === streamerUsername.toLowerCase()) {
    return res.status(400).json({
      ok: false,
      error: "El donante y el streamer no pueden ser la misma persona",
    });
  }

  try {
    const [donor, streamer, gift] = await Promise.all([
      getOrCreateUser(donorUsername, "espectador"),
      getOrCreateUser(streamerUsername, "streamer"),
      getOrCreateGift(giftLabel, String(videoUrl).trim()),
    ]);

    const { data: donation, error: donationError } = await supabase
      .from("donations")
      .insert({
        donor_id: donor.id,
        streamer_id: streamer.id,
        gift_id: gift.id,
      })
      .select("id, sent_at")
      .single();

    if (donationError) throw donationError;

    io.emit("nueva-alerta", { donorName, giftName, videoUrl });

    return res.json({
      ok: true,
      donationId: donation.id,
      sentAt: donation.sent_at,
    });
  } catch (err) {
    console.error("Error guardando donación:", err);
    return res.status(500).json({
      ok: false,
      error: err.message || "No se pudo guardar la donación",
    });
  }
});

// GET /api/coins/balance - Ver balance de monedas de un usuario
app.get("/api/coins/balance", async (req, res) => {
  const { username } = req.query;

  if (!username) {
    return res.status(400).json({
      ok: false,
      error: "Falta el parámetro username",
    });
  }

  try {
    const user = await getOrCreateUser(String(username).trim(), "espectador");

    const { data: coins, error: coinsError } = await supabase
      .from("coins")
      .select("balance, updated_at")
      .eq("user_id", user.id)
      .maybeSingle();

    if (coinsError) throw coinsError;

    return res.json({
      ok: true,
      balance: coins?.balance || 0,
      updated_at: coins?.updated_at || null,
    });
  } catch (err) {
    console.error("Error obteniendo balance:", err);
    return res.status(500).json({
      ok: false,
      error: err.message || "No se pudo obtener el balance",
    });
  }
});

// POST /api/coins/purchase - Comprar monedas
app.post("/api/coins/purchase", async (req, res) => {
  const { username, amount, paymentMethod, transactionId } = req.body || {};

  if (!username || !amount || amount <= 0) {
    return res.status(400).json({
      ok: false,
      error: "Faltan username o amount (debe ser mayor a 0)",
    });
  }

  try {
    const user = await getOrCreateUser(String(username).trim(), "espectador");

    const { data: existingCoins, error: coinsError } = await supabase
      .from("coins")
      .select("balance")
      .eq("user_id", user.id)
      .maybeSingle();

    if (coinsError) throw coinsError;

    let newBalance;
    if (existingCoins) {
      newBalance = existingCoins.balance + amount;
      const { error: updateError } = await supabase
        .from("coins")
        .update({ balance: newBalance, updated_at: new Date().toISOString() })
        .eq("user_id", user.id);

      if (updateError) throw updateError;
    } else {
      newBalance = amount;
      const { error: insertError } = await supabase
        .from("coins")
        .insert({ user_id: user.id, balance: newBalance });

      if (insertError) throw insertError;
    }

    const { error: purchaseError } = await supabase
      .from("coin_purchases")
      .insert({
        user_id: user.id,
        amount,
        payment_method: paymentMethod || null,
        transaction_id: transactionId || null,
      });

    if (purchaseError) throw purchaseError;

    return res.json({
      ok: true,
      newBalance,
      amountAdded: amount,
    });
  } catch (err) {
    console.error("Error en compra de monedas:", err);
    return res.status(500).json({
      ok: false,
      error: err.message || "No se pudo procesar la compra",
    });
  }
});

// GET /api/shop/items - Ver catálogo de tienda
app.get("/api/shop/items", async (_req, res) => {
  try {
    const { data: items, error } = await supabase
      .from("shop_items")
      .select("id, name, description, cost, image_url")
      .eq("is_active", true)
      .order("cost", { ascending: true });

    if (error) throw error;

    return res.json({
      ok: true,
      items: items || [],
    });
  } catch (err) {
    console.error("Error obteniendo items de tienda:", err);
    return res.status(500).json({
      ok: false,
      error: err.message || "No se pudo obtener el catálogo",
    });
  }
});

// POST /api/shop/redeem - Canjear items
app.post("/api/shop/redeem", async (req, res) => {
  const { username, itemId } = req.body || {};

  if (!username || !itemId) {
    return res.status(400).json({
      ok: false,
      error: "Faltan username o itemId",
    });
  }

  try {
    const user = await getOrCreateUser(String(username).trim(), "espectador");

    const { data: item, error: itemError } = await supabase
      .from("shop_items")
      .select("id, name, cost, is_active")
      .eq("id", itemId)
      .maybeSingle();

    if (itemError) throw itemError;
    if (!item) {
      return res.status(404).json({
        ok: false,
        error: "Item no encontrado",
      });
    }
    if (!item.is_active) {
      return res.status(400).json({
        ok: false,
        error: "Este item no está disponible",
      });
    }

    const { data: coins, error: coinsError } = await supabase
      .from("coins")
      .select("balance")
      .eq("user_id", user.id)
      .maybeSingle();

    if (coinsError) throw coinsError;
    if (!coins || coins.balance < item.cost) {
      return res.status(400).json({
        ok: false,
        error: "Saldo insuficiente",
        currentBalance: coins?.balance || 0,
        required: item.cost,
      });
    }

    const newBalance = coins.balance - item.cost;

    const { error: updateError } = await supabase
      .from("coins")
      .update({ balance: newBalance, updated_at: new Date().toISOString() })
      .eq("user_id", user.id);

    if (updateError) throw updateError;

    const { error: redemptionError } = await supabase
      .from("redemptions")
      .insert({
        user_id: user.id,
        item_id: item.id,
        coins_spent: item.cost,
      });

    if (redemptionError) throw redemptionError;

    return res.json({
      ok: true,
      itemName: item.name,
      coinsSpent: item.cost,
      newBalance,
    });
  } catch (err) {
    console.error("Error en canje:", err);
    return res.status(500).json({
      ok: false,
      error: err.message || "No se pudo procesar el canje",
    });
  }
});

// GET /api/redemptions/history - Historial de canjes de un usuario
app.get("/api/redemptions/history", async (req, res) => {
  const { username } = req.query;

  console.log("Historial - Username:", username);

  if (!username) {
    return res.status(400).json({
      ok: false,
      error: "Falta el parámetro username",
    });
  }

  try {
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id")
      .eq("username", String(username).trim())
      .maybeSingle();

    console.log("Historial - User error:", userError);
    console.log("Historial - User data:", user);

    if (userError) throw userError;
    if (!user) {
      return res.json({
        ok: true,
        redemptions: [],
      });
    }

    const { data: redemptions, error: redemptionsError } = await supabase
      .from("redemptions")
      .select(`
        coins_spent,
        created_at,
        shop_items (name)
      `)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);

    console.log("Historial - Redemptions error:", redemptionsError);
    console.log("Historial - Redemptions data:", redemptions);

    if (redemptionsError) throw redemptionsError;

    const formattedRedemptions = redemptions?.map((r) => ({
      itemName: r.shop_items?.name || "Item desconocido",
      coinsSpent: r.coins_spent,
      createdAt: r.created_at,
    })) || [];

    return res.json({
      ok: true,
      redemptions: formattedRedemptions,
    });
  } catch (err) {
    console.error("Error obteniendo historial de canjes:", err);
    return res.status(500).json({
      ok: false,
      error: err.message || "No se pudo obtener el historial",
    });
  }
});

io.on("connection", (socket) => {
  console.log("Cliente conectado:", socket.id);
  socket.on("disconnect", () => {
    console.log("Cliente desconectado:", socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
