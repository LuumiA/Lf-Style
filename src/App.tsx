import { useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBasketShopping } from "@fortawesome/free-solid-svg-icons";
import "./App.css";
import { hasSupabaseConfig, supabase } from "./lib/supabase";

type Product = {
  id: string;
  name: string;
  category: string;
  price: number;
  oldPrice?: number;
  image: string;
  tag?: string;
  description?: string;
  sizes: string[];
  colors: string[];
  stock: number;
  isActive: boolean;
};

type CartItem = {
  product: Product;
  quantity: number;
  size?: string;
  color?: string;
};

type Order = {
  id: string;
  status: string;
  total: number;
  createdAt: string;
  items: {
    productId: string;
    productName: string;
    unitPrice: number;
    quantity: number;
    size?: string;
    color?: string;
  }[];
};

const categories = [
  {
    name: "Robes",
    image:
      "https://images.unsplash.com/photo-1572804013309-59a88b7e92f1?auto=format&fit=crop&w=700&q=85",
  },
  {
    name: "T-shirts",
    image:
      "https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=700&q=85",
  },
  {
    name: "Sacs",
    image:
      "https://images.unsplash.com/photo-1566150905458-1bf1fc113f0d?auto=format&fit=crop&w=700&q=85",
  },
  {
    name: "Pantalons",
    image:
      "https://images.unsplash.com/photo-1584370848010-d7fe6bc767ec?auto=format&fit=crop&w=700&q=85",
  },
];

const normalizeSearch = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const orderStatusLabels: Record<string, string> = {
  pending: "En attente de paiement",
  paid: "À valider",
  preparing: "En préparation",
  shipped: "Expédiée",
  completed: "Terminée",
  cancelled: "Annulée",
};

function App() {
  const [activeCategory, setActiveCategory] = useState("Tout voir");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [modal, setModal] = useState<
    | "login"
    | "signup"
    | "contact"
    | "product"
    | "account"
    | "admin"
    | "orders"
    | null
  >(null);
  const [accountName, setAccountName] = useState("");
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [orderMessage, setOrderMessage] = useState("");
  const [cartNotice, setCartNotice] = useState("");
  const [orderSaved, setOrderSaved] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [catalog, setCatalog] = useState<Product[]>([]);
  const [authError, setAuthError] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [adminMessage, setAdminMessage] = useState("");
  const [newsletterEmail, setNewsletterEmail] = useState("");
  const [newsletterSent, setNewsletterSent] = useState(false);

  const filteredProducts = useMemo(
    () =>
      catalog.filter((product) => {
        const matchCategory =
          activeCategory === "Tout voir" || product.category === activeCategory;
        const searchTerm = normalizeSearch(search);
        const matchSearch =
          !searchTerm ||
          normalizeSearch(product.name).includes(searchTerm) ||
          normalizeSearch(product.category).includes(searchTerm);
        return matchCategory && matchSearch;
      }),
    [activeCategory, search, catalog],
  );

  const loadProfile = async (userId: string) => {
    const { data } = await supabase
      .from("profiles")
      .select("first_name, is_admin")
      .eq("id", userId)
      .maybeSingle();
    setAccountName(data?.first_name ?? "");
    setIsAdmin(data?.is_admin === true);
  };

  useEffect(() => {
    const loadCatalog = async () => {
      const { data, error } = await supabase
        .from("products")
        .select(
          "id, name, category, price, old_price, image_url, tag, description, sizes, colors, stock, is_active",
        )
        .order("created_at", { ascending: false });

      if (!error && data) {
        setCatalog(
          data.map((product) => ({
            id: product.id,
            name: product.name,
            category: product.category,
            price: Number(product.price),
            oldPrice: product.old_price ? Number(product.old_price) : undefined,
            image: product.image_url,
            tag: product.tag ?? undefined,
            description: product.description ?? undefined,
            sizes: product.sizes ?? [],
            colors: product.colors ?? [],
            stock: product.stock,
            isActive: product.is_active,
          })),
        );
      }
    };

    const loadSession = async () => {
      const { data } = await supabase.auth.getSession();
      setUserId(data.session?.user.id ?? null);
      if (data.session) await loadProfile(data.session.user.id);
    };

    void loadCatalog();
    void loadSession();

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (session) void loadProfile(session.user.id);
        else {
          setUserId(null);
          setAccountName("");
          setIsAdmin(false);
        }
        setUserId(session?.user.id ?? null);
      },
    );

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const storageKey = `lf-style-cart-${userId ?? "guest"}`;
    const params = new URLSearchParams(window.location.search);
    const payment = params.get("payment");
    const paypalToken = params.get("token");
    const cleanUrl = (keys: string[]) => {
      keys.forEach((key) => params.delete(key));
      const query = params.toString();
      window.history.replaceState(
        {},
        "",
        `${window.location.pathname}${query ? `?${query}` : ""}`,
      );
    };

    if (params.get("paypal") === "return" && paypalToken) {
      if (!userId) return;
      setOrderSaved(false);
      setIsCartOpen(true);
      supabase.functions
        .invoke("capture-paypal-order", {
          body: { paypal_order_id: paypalToken },
        })
        .then(({ data, error }) => {
          if (error || data?.status !== "COMPLETED") {
            setOrderMessage("Le paiement PayPal n'a pas pu être confirmé.");
            return;
          }
          localStorage.removeItem(storageKey);
          setCart([]);
          setOrderMessage("Paiement confirmé, merci pour votre commande !");
        });
      cleanUrl(["paypal", "token", "PayerID", "order_id"]);
      return;
    }

    if (payment === "success" || payment === "cancelled") {
      if (payment === "success") {
        localStorage.removeItem(storageKey);
        setCart([]);
        setOrderMessage("Paiement confirmé, merci pour votre commande !");
      } else {
        setOrderMessage("Paiement annulé. Votre panier a été conservé.");
      }
      setOrderSaved(false);
      setIsCartOpen(true);
      if (userId) cleanUrl(["payment", "session_id"]);
      return;
    }

    const storedCart = localStorage.getItem(storageKey);
    setCart(storedCart ? (JSON.parse(storedCart) as CartItem[]) : []);
  }, [userId]);

  useEffect(() => {
    const storageKey = `lf-style-cart-${userId ?? "guest"}`;
    localStorage.setItem(storageKey, JSON.stringify(cart));
  }, [cart, userId]);

  useEffect(() => {
    if (!userId) {
      setOrders([]);
      return;
    }
    const loadOrders = async () => {
      const { data } = await supabase
        .from("orders")
        .select(
          "id, status, total, created_at, order_items(product_id, product_name, unit_price, quantity, size, color)",
        )
        .order("created_at", { ascending: false });
      if (data)
        setOrders(
          data.map((order) => ({
            id: order.id,
            status: order.status,
            total: Number(order.total),
            createdAt: order.created_at,
            items: order.order_items.map((item) => ({
              productId: item.product_id,
              productName: item.product_name,
              unitPrice: Number(item.unit_price),
              quantity: item.quantity,
              size: item.size ?? undefined,
              color: item.color ?? undefined,
            })),
          })),
        );
    };
    void loadOrders();
  }, [userId]);

  const signIn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthError("");
    const form = new FormData(event.currentTarget);
    const { error } = await supabase.auth.signInWithPassword({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    if (error) {
      setAuthError("Email ou mot de passe incorrect.");
      return;
    }
    setModal(null);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setIsAccountMenuOpen(false);
  };

  const signUp = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthError("");
    setAuthMessage("");
    const form = new FormData(event.currentTarget);
    const { data, error } = await supabase.auth.signUp({
      email: String(form.get("email")),
      password: String(form.get("password")),
      options: {
        data: {
          first_name: String(form.get("firstName")),
          birth_date: String(form.get("birthDate")),
        },
      },
    });
    if (error) {
      setAuthError(
        error.message.includes("already")
          ? "Cette adresse e-mail possède déjà un compte."
          : "Impossible de créer le compte. Vérifiez les informations saisies.",
      );
      return;
    }
    if (data.session) {
      setModal(null);
    } else {
      setAuthMessage(
        "Compte créé. Vérifiez votre e-mail pour confirmer votre inscription.",
      );
      setModal("login");
    }
  };

  const sendContactMessage = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("contactEmail"));
    const subject = String(form.get("contactSubject"));
    const message = String(form.get("contactMessage"));
    const mailto = [
      "mailto:laura.loucas@hotmail.fr",
      `subject=${encodeURIComponent(`[LF-Style] ${subject}`)}`,
      `body=${encodeURIComponent(`Email du client : ${email}\n\n${message}`)}`,
    ]
      .join("?")
      .replace("?body=", "&body=");
    window.location.href = mailto;
    setModal(null);
  };

  const addProduct = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAdminMessage("");
    const form = new FormData(event.currentTarget);
    const imageFile = form.get("image") as File | null;
    if (!imageFile || imageFile.size === 0) {
      setAdminMessage("Choisissez une image avant d'ajouter l'article.");
      return;
    }
    if (!imageFile.type.startsWith("image/")) {
      setAdminMessage("Le fichier choisi doit être une image.");
      return;
    }
    if (imageFile.size > 5 * 1024 * 1024) {
      setAdminMessage("L'image ne doit pas dépasser 5 Mo.");
      return;
    }

    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setAdminMessage("Votre session a expiré. Reconnectez-vous.");
      return;
    }

    const safeFileName = imageFile.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    const imagePath = `${userData.user.id}/${Date.now()}-${safeFileName}`;
    const { error: uploadError } = await supabase.storage
      .from("product-images")
      .upload(imagePath, imageFile, { contentType: imageFile.type });
    if (uploadError) {
      setAdminMessage("Impossible d'envoyer cette image dans Supabase.");
      return;
    }

    const { data: publicImage } = supabase.storage
      .from("product-images")
      .getPublicUrl(imagePath);
    const { data, error } = await supabase
      .from("products")
      .insert({
        name: String(form.get("name")),
        price: Number(form.get("price")),
        category: String(form.get("category")),
        image_url: publicImage.publicUrl,
        stock: Number(form.get("stock")),
        description: String(form.get("description")),
        sizes: String(form.get("sizes"))
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        colors: String(form.get("colors"))
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        tag: form.get("tag") ? String(form.get("tag")) : null,
      })
      .select(
        "id, name, category, price, old_price, image_url, tag, description, sizes, colors, stock, is_active",
      )
      .single();
    if (error) {
      await supabase.storage.from("product-images").remove([imagePath]);
      setAdminMessage(
        "Impossible d'ajouter cet article. Vérifiez votre session admin.",
      );
      return;
    }
    if (data) {
      setCatalog((current) => [
        {
          id: data.id,
          name: data.name,
          category: data.category,
          price: Number(data.price),
          oldPrice: data.old_price ? Number(data.old_price) : undefined,
          image: data.image_url,
          tag: data.tag ?? undefined,
          description: data.description ?? undefined,
          sizes: data.sizes ?? [],
          colors: data.colors ?? [],
          stock: data.stock,
          isActive: data.is_active,
        },
        ...current,
      ]);
    }
    setAdminMessage("Article ajouté au catalogue.");
    event.currentTarget.reset();
  };

  const removeProduct = async (product: Product) => {
    if (!isAdmin || typeof product.id !== "string") return;
    if (!window.confirm(`Supprimer « ${product.name} » définitivement ?`))
      return;

    const { error } = await supabase
      .from("products")
      .delete()
      .eq("id", product.id);
    if (error) {
      setAdminMessage("Impossible de supprimer cet article.");
      return;
    }

    const imagePath = product.image.split("/product-images/")[1];
    if (imagePath) {
      await supabase.storage
        .from("product-images")
        .remove([decodeURIComponent(imagePath)]);
    }
    setCatalog((current) => current.filter((item) => item.id !== product.id));
    setAdminMessage(`« ${product.name} » a été supprimé.`);
  };

  const updateProduct = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingProduct) return;
    const form = new FormData(event.currentTarget);
    const { data, error } = await supabase
      .from("products")
      .update({
        name: String(form.get("name")),
        price: Number(form.get("price")),
        category: String(form.get("category")),
        stock: Number(form.get("stock")),
        description: String(form.get("description")),
        sizes: String(form.get("sizes"))
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        colors: String(form.get("colors"))
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      })
      .eq("id", editingProduct.id)
      .select(
        "id, name, category, price, old_price, image_url, tag, description, sizes, colors, stock, is_active",
      )
      .single();
    if (error) {
      setAdminMessage("Impossible de modifier cet article.");
      return;
    }
    setCatalog((current) =>
      current.map((product) =>
        product.id === data.id
          ? {
              id: data.id,
              name: data.name,
              category: data.category,
              price: Number(data.price),
              oldPrice: data.old_price ? Number(data.old_price) : undefined,
              image: data.image_url,
              tag: data.tag ?? undefined,
              description: data.description ?? undefined,
              sizes: data.sizes ?? [],
              colors: data.colors ?? [],
              stock: data.stock,
              isActive: data.is_active,
            }
          : product,
      ),
    );
    setEditingProduct(null);
    setAdminMessage("Article modifié.");
  };

  const toggleProduct = async (product: Product) => {
    const { data, error } = await supabase
      .from("products")
      .update({ is_active: !product.isActive })
      .eq("id", product.id)
      .select("is_active")
      .single();
    if (error) {
      setAdminMessage("Impossible de modifier la visibilité de cet article.");
      return;
    }
    setCatalog((current) =>
      current.map((item) =>
        item.id === product.id ? { ...item, isActive: data.is_active } : item,
      ),
    );
    setAdminMessage(
      data.is_active ? "Article remis en ligne." : "Article mis en pause.",
    );
  };

  const addToCart = (
    product: Product,
    quantity = 1,
    size?: string,
    color?: string,
  ) => {
    const alreadyInCart = cart
      .filter((item) => item.product.id === product.id)
      .reduce((total, item) => total + item.quantity, 0);
    if (alreadyInCart + quantity > product.stock) {
      setCartNotice(
        `Stock disponible : ${Math.max(0, product.stock - alreadyInCart)} article${product.stock - alreadyInCart > 1 ? "s" : ""}.`,
      );
      window.setTimeout(() => setCartNotice(""), 2800);
      return false;
    }
    setCart((current) => {
      const existing = current.find(
        (item) =>
          item.product.id === product.id &&
          ((item.size === size && item.color === color) ||
            (!item.size && !item.color) ||
            (!size && !color)),
      );
      if (existing)
        return current.map((item) =>
          item === existing
            ? {
                ...item,
                quantity: item.quantity + quantity,
                size: size ?? item.size,
                color: color ?? item.color,
              }
            : item,
        );
      return [...current, { product, quantity, size, color }];
    });
    setOrderSaved(false);
    setOrderMessage("");
    setCartNotice(`${product.name} a été ajouté au panier.`);
    window.setTimeout(() => setCartNotice(""), 2800);
    return true;
  };
  const removeFromCart = (index: number) => {
    setOrderSaved(false);
    setCart((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };
  const changeQuantity = (index: number, quantity: number) => (
    setOrderSaved(false),
    setCart((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              quantity: Math.max(1, Math.min(quantity, item.product.stock)),
            }
          : item,
      ),
    )
  );
  const cartCount = cart.reduce((total, item) => total + item.quantity, 0);
  const selectedProductCartQuantity = selectedProduct
    ? cart
        .filter((item) => item.product.id === selectedProduct.id)
        .reduce((total, item) => total + item.quantity, 0)
    : 0;
  const selectedProductAvailableStock = selectedProduct
    ? Math.max(0, selectedProduct.stock - selectedProductCartQuantity)
    : 0;
  const cartTotal = cart.reduce(
    (total, item) => total + item.product.price * item.quantity,
    0,
  );

  const startCheckout = async () => {
    if (!userId) {
      setModal("login");
      return;
    }
    setOrderMessage("");
    const { data, error } = await supabase.functions.invoke(
      "create-checkout-session",
      {
        body: {
          items: cart.map((item) => ({
            product_id: item.product.id,
            quantity: item.quantity,
            size: item.size,
            color: item.color,
          })),
        },
      },
    );
    if (error || !data?.url) {
      const message = data?.error ?? error?.message ?? "CHECKOUT_FAILED";
      setOrderMessage(
        message.includes("INSUFFICIENT_STOCK")
          ? "Stock insuffisant pour un article du panier."
          : "Impossible d'ouvrir le paiement. Vérifiez la configuration Stripe.",
      );
      return;
    }
    setOrderSaved(true);
    window.location.assign(data.url);
  };

  const startPaypalCheckout = async () => {
    if (!userId) {
      setModal("login");
      return;
    }
    setOrderMessage("");
    const { data, error } = await supabase.functions.invoke(
      "create-paypal-order",
      {
        body: {
          items: cart.map((item) => ({
            product_id: item.product.id,
            quantity: item.quantity,
            size: item.size,
            color: item.color,
          })),
        },
      },
    );
    if (error || !data?.url) {
      const message = data?.error ?? error?.message ?? "CHECKOUT_FAILED";
      setOrderMessage(
        message.includes("INSUFFICIENT_STOCK")
          ? "Stock insuffisant pour un article du panier."
          : "Impossible d'ouvrir le paiement. Vérifiez la configuration PayPal.",
      );
      return;
    }
    setOrderSaved(true);
    window.location.assign(data.url);
  };

  const updateOrderStatus = async (orderId: string, status: string) => {
    const { error } = await supabase
      .from("orders")
      .update({ status })
      .eq("id", orderId);
    if (!error)
      setOrders((current) =>
        current.map((order) =>
          order.id === orderId ? { ...order, status } : order,
        ),
      );
  };

  const cancelOrder = async (orderId: string) => {
    if (
      !window.confirm("Annuler cette commande et remettre le stock en place ?")
    )
      return false;
    const { error } = await supabase.rpc("cancel_order", {
      target_order_id: orderId,
    });
    if (error) {
      setAdminMessage("Impossible d'annuler cette commande.");
      return false;
    }
    setOrders((current) =>
      current.map((order) =>
        order.id === orderId ? { ...order, status: "cancelled" } : order,
      ),
    );
    setAdminMessage("Commande annulée et stock restauré.");
    return true;
  };

  const modifyOrder = async (order: Order) => {
    if (order.status !== "pending") return;
    const cancelled = await cancelOrder(order.id);
    if (!cancelled) return;
    const restoredItems = order.items.flatMap((item) => {
      const product = catalog.find(
        (catalogProduct) => catalogProduct.id === item.productId,
      );
      return product
        ? [
            {
              product,
              quantity: item.quantity,
              size: item.size,
              color: item.color,
            },
          ]
        : [];
    });
    setCart(restoredItems);
    setOrderSaved(false);
    setOrderMessage(
      "Commande annulée pour modification. Votre panier a été restauré.",
    );
    setModal(null);
    setIsCartOpen(true);
  };

  const deleteOrder = async (orderId: string) => {
    if (!window.confirm("Supprimer définitivement cette commande annulée ?"))
      return;
    const { error } = await supabase
      .from("orders")
      .delete()
      .eq("id", orderId)
      .eq("status", "cancelled");
    if (error) {
      setAdminMessage("Seules les commandes annulées peuvent être supprimées.");
      return;
    }
    setOrders((current) => current.filter((order) => order.id !== orderId));
    setAdminMessage("Commande supprimée.");
  };

  if (!hasSupabaseConfig) {
    return (
      <main className="config-error">
        <p className="eyebrow">Configuration nécessaire</p>
        <h1>LF-Style</h1>
        <p>
          Les variables Supabase ne sont pas disponibles sur ce déploiement.
          Ajoutez <strong>VITE_SUPABASE_URL</strong> et{" "}
          <strong>VITE_SUPABASE_PUBLISHABLE_KEY</strong> dans Vercel, puis
          redéployez le projet.
        </p>
      </main>
    );
  }

  return (
    <div className="site-shell">
      {cartNotice && (
        <div className="cart-toast" role="status">
          {cartNotice}
        </div>
      )}
      <div className="announcement">
        Livraison offerte dès 100€ <span>·</span> Retours sous 14 jours
      </div>
      <header className="header">
        <button className="mobile-menu" aria-label="Ouvrir le menu">
          ☰
        </button>
        <a className="brand" href="#top">
          LF-Style<span>.</span>
        </a>
        <nav className="nav" aria-label="Navigation principale">
          <a href="#nouveautes">Nouveautés</a>
          <a href="#shop">La collection</a>
          <a href="#categories">Catégories</a>
        </nav>
        <div className="header-actions">
          <label className="search-box">
            <span>⌕</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  document
                    .getElementById("shop")
                    ?.scrollIntoView({ behavior: "smooth" });
                }
              }}
              placeholder="Rechercher"
              aria-label="Rechercher un article"
            />
          </label>
          <div className="account-area">
            <button
              className="icon-button account-button"
              onClick={() => {
                if (accountName) setIsAccountMenuOpen((open) => !open);
                else setModal("login");
              }}
              aria-label="Mon compte"
              aria-expanded={accountName ? isAccountMenuOpen : undefined}
            >
              {accountName ? `Bonjour ${accountName}` : "♙"}
            </button>
            {accountName && isAccountMenuOpen && (
              <div className="account-menu">
                <button
                  onClick={() => {
                    setIsAccountMenuOpen(false);
                    setModal(isAdmin ? "orders" : "account");
                  }}
                >
                  {isAdmin ? "Gestion des commandes" : "Mes commandes"}
                </button>
                {isAdmin && (
                  <button
                    onClick={() => {
                      setIsAccountMenuOpen(false);
                      setEditingProduct(null);
                      setModal("admin");
                    }}
                  >
                    Catalogue admin
                  </button>
                )}
                <button onClick={() => void signOut()}>Se déconnecter</button>
              </div>
            )}
          </div>
          <button
            className="bag-button"
            onClick={() => setIsCartOpen(true)}
            aria-label="Ouvrir le panier"
          >
            <FontAwesomeIcon icon={faBasketShopping} /> <b>{cartCount}</b>
          </button>
        </div>
      </header>

      <main id="top">
        <section className="hero" id="nouveautes">
          <div className="hero-copy">
            <p className="eyebrow">Collection automne / hiver 2024</p>
            <h1>
              Le style,
              <br />
              <em>sans effort.</em>
            </h1>
            <p className="hero-text">
              Des pièces pensées pour suivre vos journées, avec juste ce qu'il
              faut de caractère.
            </p>
            <a className="button button-dark" href="#shop">
              Découvrir la collection <span>↗</span>
            </a>
          </div>
          <div className="hero-image">
            <img
              src="https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=1300&q=90"
              alt="Sélection de vêtements LF-Style"
            />
            <div className="hero-sticker">
              LF-Style
              <br />
              <small>est. 2024</small>
            </div>
          </div>
        </section>

        <section className="trust-bar">
          <div>
            <strong>01</strong>
            <span>
              Petites séries
              <br />
              <small>Des pièces qui ne courent pas les rues</small>
            </span>
          </div>
          <div>
            <strong>02</strong>
            <span>
              Choisi avec soin
              <br />
              <small>Des matières qui durent</small>
            </span>
          </div>
          <div>
            <strong>03</strong>
            <span>
              Expédition rapide
              <br />
              <small>Préparé avec attention</small>
            </span>
          </div>
        </section>

        <section className="section" id="categories">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Explorer</p>
              <h2>Selon vos envies</h2>
            </div>
            <a href="#shop" className="text-link">
              Voir toutes les catégories ↗
            </a>
          </div>
          <div className="category-grid">
            {categories.map((category) => (
              <button
                className="category-card"
                key={category.name}
                onClick={() => {
                  setActiveCategory(category.name);
                  document
                    .getElementById("shop")
                    ?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                <img src={category.image} alt={category.name} />
                <span>
                  <strong>{category.name}</strong>
                  <small>
                    {String(
                      catalog.filter(
                        (product) => product.category === category.name,
                      ).length,
                    ).padStart(2, "0")}{" "}
                    pièces
                  </small>
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="section shop-section" id="shop">
          <div className="section-heading shop-heading">
            <div>
              <p className="eyebrow">La sélection LF-Style</p>
              <h2>Les essentiels du moment</h2>
            </div>
            <div className="filters">
              <button
                className={activeCategory === "Tout voir" ? "active" : ""}
                onClick={() => setActiveCategory("Tout voir")}
              >
                Tout voir
              </button>
              {["Robes", "Pulls", "Sacs", "Pantalons"].map((category) => (
                <button
                  className={activeCategory === category ? "active" : ""}
                  key={category}
                  onClick={() => setActiveCategory(category)}
                >
                  {category}
                </button>
              ))}
            </div>
          </div>
          <div className="product-grid">
            {filteredProducts.map((product) => (
              <article className="product-card" key={product.id}>
                <div className="product-image">
                  <img src={product.image} alt={product.name} />
                  {product.tag && (
                    <span
                      className={
                        product.tag.includes("-") ? "sale-tag" : "new-tag"
                      }
                    >
                      {product.tag}
                    </span>
                  )}
                  <button
                    className="quick-add"
                    disabled={product.stock === 0 || !product.isActive}
                    onClick={() => addToCart(product)}
                  >
                    {!product.isActive
                      ? "Article en pause"
                      : product.stock === 0
                        ? "Rupture de stock"
                        : "Ajouter au panier"}{" "}
                    <span>+</span>
                  </button>
                  <button
                    className="product-details"
                    onClick={() => {
                      setSelectedProduct(product);
                      setModal("product");
                    }}
                  >
                    Voir le détail
                  </button>
                  {isAdmin && typeof product.id === "string" && (
                    <>
                      <button
                        className="edit-product"
                        onClick={() => {
                          setEditingProduct(product);
                          setModal("admin");
                        }}
                      >
                        Modifier
                      </button>
                      <button
                        className="pause-product"
                        onClick={() => void toggleProduct(product)}
                      >
                        {product.isActive ? "Pause" : "En ligne"}
                      </button>
                      <button
                        className="delete-product"
                        onClick={() => void removeProduct(product)}
                        aria-label={`Supprimer ${product.name}`}
                      >
                        Supprimer
                      </button>
                    </>
                  )}
                </div>
                <div className="product-info">
                  <div>
                    <h3>{product.name}</h3>
                    <p>
                      {product.category} · {product.stock} en stock
                    </p>
                  </div>
                  <div className="price">
                    <strong>{product.price}€</strong>
                    {product.oldPrice && <del>{product.oldPrice}€</del>}
                  </div>
                </div>
              </article>
            ))}
          </div>
          {filteredProducts.length === 0 && (
            <p className="empty-state">
              Aucun article ne correspond à votre recherche.
            </p>
          )}
        </section>

        <section className="editorial">
          <div className="editorial-image">
            <img
              src="https://images.unsplash.com/photo-1485968579580-b6d095142e6e?auto=format&fit=crop&w=1100&q=85"
              alt="Détails d'une tenue LF-Style"
            />
          </div>
          <div className="editorial-copy">
            <p className="eyebrow">LF-Style, en quelques mots</p>
            <h2>
              Des vêtements
              <br />
              <em>qui vous ressemblent.</em>
            </h2>
            <p>
              Une garde-robe libre, féminine et facile à vivre. On sélectionne
              chaque pièce comme si elle devait devenir votre nouvelle préférée.
            </p>
            <a className="text-link" href="#newsletter">
              En savoir plus ↗
            </a>
          </div>
        </section>

        <section className="newsletter" id="newsletter">
          <p className="eyebrow">Le mot doux du dimanche</p>
          <h2>Du beau dans votre boîte mail.</h2>
          <p>
            Les nouveautés, les inspirations et les petites surprises. Pas de
            bruit, promis.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setNewsletterSent(true);
            }}
          >
            <input
              type="email"
              required
              placeholder="Votre adresse e-mail"
              value={newsletterEmail}
              onChange={(event) => setNewsletterEmail(event.target.value)}
            />
            <button className="button button-dark">
              {newsletterSent ? "Merci !" : "S'inscrire"} <span>↗</span>
            </button>
          </form>
        </section>
      </main>

      <footer className="footer">
        <div>
          <a className="brand" href="#top">
            LF-Style<span>.</span>
          </a>
          <p>Le vestiaire qui vous suit partout.</p>
        </div>
        <div className="footer-links">
          <a href="#shop">Boutique</a>
          <a href="#categories">Catégories</a>
          <button type="button" onClick={() => setModal("contact")}>
            Contact
          </button>
        </div>
        <div className="socials">
          <a
            href="https://www.instagram.com/laurafaudet/"
            target="_blank"
            rel="noreferrer"
          >
            Instagram
          </a>
          <a
            href="https://www.facebook.com/profile.php?id=100009095319764"
            target="_blank"
            rel="noreferrer"
          >
            Facebook
          </a>
          <a
            href="https://www.tiktok.com/@laurafaudet"
            target="_blank"
            rel="noreferrer"
          >
            TikTok
          </a>
        </div>
      </footer>

      {isCartOpen && (
        <div className="overlay" onClick={() => setIsCartOpen(false)}>
          <aside
            className="side-panel"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="panel-header">
              <div>
                <p className="eyebrow">Votre sélection</p>
                <h2>
                  Panier <span>{cartCount}</span>
                </h2>
              </div>
              <button
                className="close-button"
                onClick={() => setIsCartOpen(false)}
              >
                ×
              </button>
            </div>
            {cart.length === 0 ? (
              <div className="empty-cart">
                <span>
                  <FontAwesomeIcon icon={faBasketShopping} />
                </span>
                <p>Votre panier est encore vide.</p>
                {orderMessage && <p className="form-success">{orderMessage}</p>}
                <a href="#shop" onClick={() => setIsCartOpen(false)}>
                  Découvrir les pièces
                </a>
              </div>
            ) : (
              <>
                <div className="cart-items">
                  {cart.map((item, index) => (
                    <div
                      className="cart-item"
                      key={`${item.product.id}-${index}`}
                    >
                      <img src={item.product.image} alt="" />
                      <div>
                        <h3>{item.product.name}</h3>
                        <p>{item.product.price * item.quantity}€</p>
                        <div className="quantity-control">
                          <button
                            onClick={() =>
                              changeQuantity(index, item.quantity - 1)
                            }
                            aria-label="Diminuer la quantité"
                          >
                            −
                          </button>
                          <span>{item.quantity}</span>
                          <button
                            onClick={() =>
                              changeQuantity(index, item.quantity + 1)
                            }
                            aria-label="Augmenter la quantité"
                          >
                            +
                          </button>
                        </div>
                        <button onClick={() => removeFromCart(index)}>
                          Retirer
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="cart-summary">
                  <div>
                    <span>Sous-total</span>
                    <strong>{cartTotal}€</strong>
                  </div>
                  <small>Livraison calculée au paiement</small>
                  <button
                    className="button button-dark checkout-button"
                    disabled={orderSaved}
                    onClick={() => void startCheckout()}
                  >
                    {orderSaved
                      ? "Redirection vers le paiement"
                      : "Payer par carte"}{" "}
                    <span>↗</span>
                  </button>
                  <button
                    className="button button-paypal checkout-button"
                    disabled={orderSaved}
                    onClick={() => void startPaypalCheckout()}
                  >
                    {orderSaved
                      ? "Redirection vers le paiement"
                      : "Payer avec PayPal"}{" "}
                    <span>↗</span>
                  </button>
                  {orderMessage && (
                    <p className="payment-note">{orderMessage}</p>
                  )}
                  <p className="payment-note">
                    Paiement sécurisé par carte bancaire ou PayPal
                  </p>
                </div>
              </>
            )}
          </aside>
        </div>
      )}

      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <button className="close-button" onClick={() => setModal(null)}>
              ×
            </button>
            {modal === "login" ? (
              <>
                <p className="eyebrow">Espace personnel</p>
                <h2>Ravi de vous revoir.</h2>
                <p className="modal-intro">
                  Connectez-vous pour retrouver vos favoris et suivre vos
                  commandes.
                </p>
                <form onSubmit={signIn}>
                  <label>
                    Email
                    <input
                      name="email"
                      type="email"
                      required
                      placeholder="vous@exemple.fr"
                    />
                  </label>
                  <label>
                    Mot de passe
                    <input
                      name="password"
                      type="password"
                      required
                      placeholder="••••••••"
                    />
                  </label>
                  <button className="button button-dark full-button">
                    Se connecter <span>↗</span>
                  </button>
                </form>
                {authError && <p className="form-error">{authError}</p>}
                {authMessage && <p className="form-success">{authMessage}</p>}
                <p className="form-foot">
                  Pas encore de compte ?{" "}
                  <button
                    onClick={() => {
                      setAuthError("");
                      setAuthMessage("");
                      setModal("signup");
                    }}
                  >
                    Créer un compte
                  </button>
                </p>
              </>
            ) : modal === "account" ? (
              <>
                <p className="eyebrow">Votre espace</p>
                <h2>Mes commandes</h2>
                {orders.length === 0 ? (
                  <p className="modal-intro">
                    Vous n'avez pas encore de commande.
                  </p>
                ) : (
                  <div className="account-orders">
                    {orders.map((order) => (
                      <div className="account-order" key={order.id}>
                        <div>
                          <strong>Commande #{order.id.slice(0, 8)}</strong>
                          <small>
                            {new Date(order.createdAt).toLocaleDateString(
                              "fr-FR",
                            )}
                          </small>
                        </div>
                        <div>
                          <strong>{order.total.toFixed(2)}€</strong>
                          <small>
                            {orderStatusLabels[order.status] ?? order.status}
                          </small>
                          {order.status === "pending" && (
                            <div className="account-order-actions">
                              <button onClick={() => void modifyOrder(order)}>
                                Modifier
                              </button>
                              <button
                                onClick={() => void cancelOrder(order.id)}
                              >
                                Annuler
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : modal === "product" && selectedProduct ? (
              <>
                <img
                  className="product-modal-image"
                  src={selectedProduct.image}
                  alt={selectedProduct.name}
                />
                <p className="eyebrow">{selectedProduct.category}</p>
                <h2>{selectedProduct.name}</h2>
                <p className="product-modal-price">{selectedProduct.price}€</p>
                <p className="modal-intro">
                  {selectedProduct.description ||
                    "Une pièce choisie avec soin pour compléter votre vestiaire."}
                </p>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    const added = addToCart(
                      selectedProduct,
                      Number(form.get("quantity")),
                      String(form.get("size") || "") || undefined,
                      String(form.get("color") || "") || undefined,
                    );
                    if (added) {
                      setModal(null);
                      setIsCartOpen(true);
                    }
                  }}
                >
                  {selectedProduct.sizes.length > 0 && (
                    <label>
                      Taille
                      <select
                        name="size"
                        defaultValue={selectedProduct.sizes[0]}
                      >
                        {selectedProduct.sizes.map((size) => (
                          <option key={size}>{size}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  {selectedProduct.colors.length > 0 && (
                    <label>
                      Couleur
                      <select
                        name="color"
                        defaultValue={selectedProduct.colors[0]}
                      >
                        {selectedProduct.colors.map((color) => (
                          <option key={color}>{color}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label>
                    Quantité
                    <input
                      name="quantity"
                      type="number"
                      min="1"
                      max={selectedProductAvailableStock}
                      defaultValue="1"
                      required
                    />
                  </label>
                  <p className="stock-note">
                    {selectedProductAvailableStock} disponible
                    {selectedProductAvailableStock > 1 ? "s" : ""}
                  </p>
                  <button
                    className="button button-dark full-button"
                    disabled={selectedProductAvailableStock === 0}
                  >
                    {selectedProductAvailableStock === 0
                      ? "Rupture de stock"
                      : "Ajouter au panier"}{" "}
                    <span>+</span>
                  </button>
                </form>
              </>
            ) : modal === "contact" ? (
              <>
                <p className="eyebrow">Écrivez-nous</p>
                <h2>Une question ?</h2>
                <p className="modal-intro">
                  Remplissez ce formulaire et votre messagerie préparera un
                  e-mail pour LF-Style.
                </p>
                <form onSubmit={sendContactMessage}>
                  <label>
                    Votre e-mail
                    <input
                      name="contactEmail"
                      type="email"
                      required
                      placeholder="vous@exemple.fr"
                    />
                  </label>
                  <label>
                    Motif
                    <select
                      name="contactSubject"
                      defaultValue="Question sur un article"
                    >
                      <option>Question sur un article</option>
                      <option>Suivi de commande</option>
                      <option>Livraison ou retour</option>
                      <option>Autre demande</option>
                    </select>
                  </label>
                  <label>
                    Votre message
                    <textarea
                      name="contactMessage"
                      required
                      rows={5}
                      placeholder="Écrivez votre message..."
                    />
                  </label>
                  <button className="button button-dark full-button">
                    Préparer l'e-mail <span>↗</span>
                  </button>
                </form>
              </>
            ) : modal === "signup" ? (
              <>
                <p className="eyebrow">Créer votre espace</p>
                <h2>Bienvenue chez LF-Style.</h2>
                <p className="modal-intro">
                  Créez votre compte pour suivre vos commandes et retrouver vos
                  coups de cœur.
                </p>
                <form onSubmit={signUp}>
                  <label>
                    Prénom
                    <input name="firstName" required placeholder="Laura" />
                  </label>
                  <label>
                    E-mail
                    <input
                      name="email"
                      type="email"
                      required
                      placeholder="vous@exemple.fr"
                    />
                  </label>
                  <label>
                    Date d'anniversaire
                    <input name="birthDate" type="date" required />
                  </label>
                  <label>
                    Mot de passe
                    <input
                      name="password"
                      type="password"
                      minLength={8}
                      required
                      placeholder="8 caractères minimum"
                    />
                  </label>
                  <button className="button button-dark full-button">
                    Créer mon compte <span>↗</span>
                  </button>
                </form>
                {authError && <p className="form-error">{authError}</p>}
                <p className="form-foot">
                  Vous avez déjà un compte ?{" "}
                  <button
                    onClick={() => {
                      setAuthError("");
                      setModal("login");
                    }}
                  >
                    Se connecter
                  </button>
                </p>
              </>
            ) : modal === "orders" ? (
              <>
                <p className="eyebrow">Espace administrateur</p>
                <h2>Gestion des commandes</h2>
                <p className="modal-intro">
                  Suivez les commandes et faites avancer chaque étape de
                  préparation.
                </p>
                <div className="order-stats">
                  <div>
                    <strong>
                      {
                        orders.filter((order) => order.status === "pending")
                          .length
                      }
                    </strong>
                    <span>À payer</span>
                  </div>
                  <div>
                    <strong>
                      {orders.filter((order) => order.status === "paid").length}
                    </strong>
                    <span>À valider</span>
                  </div>
                  <div>
                    <strong>
                      {
                        orders.filter((order) =>
                          ["preparing", "shipped"].includes(order.status),
                        ).length
                      }
                    </strong>
                    <span>En cours</span>
                  </div>
                  <div>
                    <strong>
                      {
                        orders.filter((order) => order.status === "completed")
                          .length
                      }
                    </strong>
                    <span>Terminées</span>
                  </div>
                </div>
                {adminMessage && <p className="form-success">{adminMessage}</p>}
                <div className="admin-orders admin-orders-panel">
                  <p className="eyebrow">Toutes les commandes</p>
                  {orders.length === 0 ? (
                    <p className="admin-empty">Aucune commande enregistrée.</p>
                  ) : (
                    orders.map((order) => (
                      <div className="admin-order" key={order.id}>
                        <div>
                          <strong>#{order.id.slice(0, 8)}</strong>
                          <small>
                            {new Date(order.createdAt).toLocaleDateString(
                              "fr-FR",
                            )}{" "}
                            · {order.total.toFixed(2)}€
                          </small>
                        </div>
                        <div className="order-actions">
                          <select
                            value={order.status}
                            onChange={(event) =>
                              void updateOrderStatus(
                                order.id,
                                event.target.value,
                              )
                            }
                            aria-label="Statut de la commande"
                          >
                            <option value="pending">
                              En attente de paiement
                            </option>
                            <option value="paid">À valider</option>
                            <option value="preparing">En préparation</option>
                            <option value="shipped">Expédiée</option>
                            <option value="completed">Terminée</option>
                            <option value="cancelled">Annulée</option>
                          </select>
                          {order.status !== "cancelled" &&
                            order.status !== "completed" && (
                              <button
                                className="cancel-order"
                                onClick={() => void cancelOrder(order.id)}
                              >
                                Annuler
                              </button>
                            )}
                          {order.status === "cancelled" && (
                            <button
                              className="delete-order"
                              onClick={() => void deleteOrder(order.id)}
                            >
                              Supprimer
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            ) : (
              <>
                <p className="eyebrow">Gestion de la boutique</p>
                <h2>
                  {editingProduct
                    ? "Modifier la pièce"
                    : `Bonjour, ${accountName || "Laura"}.`}
                </h2>
                <p className="modal-intro">
                  Ajoutez, modifiez et mettez en pause les pièces de la
                  boutique.
                </p>
                <form onSubmit={editingProduct ? updateProduct : addProduct}>
                  <label>
                    Nom du produit
                    <input
                      name="name"
                      required
                      defaultValue={editingProduct?.name}
                      placeholder="Ex. Robe Alba"
                    />
                  </label>
                  <label>
                    Prix
                    <input
                      name="price"
                      required
                      type="number"
                      min="0"
                      step="0.01"
                      defaultValue={editingProduct?.price}
                      placeholder="79"
                    />
                  </label>
                  <label>
                    Catégorie
                    <select
                      name="category"
                      defaultValue={editingProduct?.category || "Robes"}
                    >
                      <option>Robes</option>
                      <option>Pulls</option>
                      <option>Sacs</option>
                      <option>Pantalons</option>
                    </select>
                  </label>
                  <label>
                    Photo du produit
                    {!editingProduct && (
                      <input
                        name="image"
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        required
                      />
                    )}
                  </label>
                  <label>
                    Description
                    <textarea
                      name="description"
                      rows={3}
                      defaultValue={editingProduct?.description}
                      placeholder="Décrivez cette pièce..."
                    />
                  </label>
                  <label>
                    Tailles disponibles
                    <input
                      name="sizes"
                      defaultValue={editingProduct?.sizes.join(", ")}
                      placeholder="S, M, L"
                    />
                  </label>
                  <label>
                    Couleurs disponibles
                    <input
                      name="colors"
                      defaultValue={editingProduct?.colors.join(", ")}
                      placeholder="Noir, Écru"
                    />
                  </label>
                  <label>
                    Stock
                    <input
                      name="stock"
                      required
                      type="number"
                      min="0"
                      defaultValue={editingProduct?.stock}
                      placeholder="1"
                    />
                  </label>
                  <button className="button button-dark full-button">
                    {editingProduct
                      ? "Enregistrer les modifications"
                      : "Ajouter la pièce"}{" "}
                    <span>{editingProduct ? "↗" : "+"}</span>
                  </button>
                </form>
                {adminMessage && <p className="form-success">{adminMessage}</p>}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
