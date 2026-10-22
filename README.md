# 🤖 Athar – Bot WhatsApp pour coopératives marocaines

Bot WhatsApp (Node.js) qui permet aux coopératives artisanales de **publier, gérer et vendre leurs produits** directement depuis WhatsApp, en **français, arabe, darija et hassania**, par texte ou **message vocal**. Il expose aussi une **API REST** utilisée par le site web (boutique, fiche produit, commandes).

> Réalisé par Ahmed Elaajlaoui

---

## ✨ Fonctionnalités

- 📸 **Publication guidée** : photos (jusqu'à 3) → nom → prix → stock → description → récapitulatif → publication
- 🧠 **IA Gemini** : analyse de l'image (catégorie, nom et description en FR / AR / EN), compréhension des intentions en darija / arabizi, transcription des vocaux
- 🎙️ **Messages vocaux** : l'artisan peut répondre en vocal ; le bot répond aussi en note vocale (Google TTS + FFmpeg)
- 🎬 **Vidéo promo automatique** (FFmpeg + sharp) pour les statuts WhatsApp et Reels, avec voix off
- 🏷️ **QR code colis** généré pour chaque produit ; scanner le QR (envoyé en image au bot) affiche les infos du colis pour le livreur
- ⚙️ **Gestion des produits** : liste, modification, suppression, stock, menu guidé `GERER`
- 🔔 **Alertes de stock** (stock faible ≤ 3 ou épuisé) et **notification de chaque commande** envoyées à la coopérative
- 🛒 **API de commande** avec décrémentation atomique du stock
- 🔒 Contrôle d'accès par numéro de téléphone, vérification des prix suspects, limitation du débit (IA, commandes, API)

---

## 🧱 Technologies

| Rôle | Bibliothèque |
|---|---|
| WhatsApp | `whatsapp-web.js`, `qrcode-terminal` |
| IA | `@google/genai` (Gemini) |
| Images / QR | `sharp`, `qrcode`, `jsqr` |
| Audio / vidéo | `@ffmpeg-installer/ffmpeg`, `google-tts-api` |
| Serveur | `express` (+ `helmet`, `cors`, `express-rate-limit` en option) |
| Config | `dotenv` |

---

## 🚀 Installation

### Prérequis
- Node.js 18+
- Google Chrome installé (utilisé par `whatsapp-web.js`)
- Une clé API Gemini

### Étapes

```bash
git clone <url-du-depot>
cd <dossier-du-bot>
npm install
```

Dépendances principales :

```bash
npm install dotenv @google/genai whatsapp-web.js qrcode-terminal qrcode jsqr sharp express @ffmpeg-installer/ffmpeg google-tts-api
npm install helmet cors express-rate-limit   # recommandés
```

### Configuration `.env`

Créer un fichier `.env` à la racine du bot :

```env
GEMINI_API_KEY=ta_cle_gemini
GEMINI_MODELS=gemini-3.8-flash,gemini-3.7-flash,gemini-3.5-flash
PORT=3001
SITE_URL=https://ton-domaine-ou-ngrok.example
API_KEY=une_cle_secrete_pour_modifier_le_stock
```

| Variable | Description |
|---|---|
| `GEMINI_API_KEY` | Clé API Google Gemini (obligatoire) |
| `GEMINI_MODELS` | Modèles à essayer dans l'ordre (bascule automatique en cas d'erreur) |
| `PORT` | Port du serveur Express (défaut : `3001`) |
| `SITE_URL` | URL publique utilisée dans les liens et les QR codes (ne pas laisser `localhost` en production) |
| `API_KEY` | Protège `PATCH /api/products/:id/stock` (en-tête `x-api-key`) |

### Lancement

```bash
node index.js
```

Au premier démarrage, **scanner le QR code** affiché dans le terminal avec WhatsApp (*Appareils connectés*). La session est ensuite conservée dans `whatsapp_session/`.

---

## 👥 Coopératives

Les coopératives autorisées sont définies dans `cooperatives.json` (créé automatiquement avec des exemples au premier lancement) :

```json
{
  "coopId": "COOP_01",
  "name": "Sahara Artisans",
  "managerName": "Ahmed",
  "phone": "2126XXXXXXXX",
  "altPhone": "",
  "city": "Laâyoune",
  "region": "Laâyoune-Sakia El Hamra",
  "specialty": "Cuir et bijoux traditionnels"
}
```

- Un numéro non enregistré n'a **pas accès** au bot (sauf pour scanner un QR de colis).
- Ajouter `"canPublish": false` pour suspendre le droit de publier / modifier d'une coopérative.
- ⚠️ Les numéros de téléphone ne sont **jamais** renvoyés par l'API publique.

---

## 💬 Commandes WhatsApp

| Commande (FR) | Arabe | Action |
|---|---|---|
| `PUBLIER` | `نشر` | Ajouter un produit |
| `MES PRODUITS` | `منتجاتي` | Voir ses produits |
| `GERER <réf>` | `تسيير <réf>` | Menu guidé (prix, nom, description, stock, suppression) |
| `MODIFIER <réf> prix\|nom\|description\|stock <valeur>` | `تعديل ...` | Modification directe |
| `SUPPRIMER <réf>` | `حذف <réf>` | Supprimer (avec confirmation) |
| `STOCK <réf> <qté>` | `مخزون <réf> <qté>` | Changer le stock (0 = épuisé) |
| `FIN` / `صافي` | | Terminer l'envoi des photos |
| `ANNULER` | `إلغاء` | Annuler l'opération en cours |
| `AIDE` | `مساعدة` | Afficher l'aide |

Le bot comprend aussi des phrases libres, par exemple : *« bghit nzid sel3a »*, *« werini sel3ti »*.

### Flux de publication

```
Photos (max 3) → FIN → Nom → Prix → Stock → Description → Récapitulatif → OUI
        ↓
  Produit publié + QR code + vidéo promo générée en arrière-plan
```

---

## 🌐 API REST

| Méthode | Route | Description |
|---|---|---|
| `GET` | `/api/products` | Liste des produits (filtres : `q`, `coopId`, `city`, `region`, `minPrice`, `maxPrice`, `limit`, `page`) |
| `GET` | `/api/products/:id` | Détail d'un produit |
| `GET` | `/api/cooperatives` | Liste des coopératives (infos publiques) |
| `GET` | `/api/cooperatives/:coopId/products` | Produits d'une coopérative |
| `POST` | `/api/orders` | Commande de plusieurs produits `{ customer, items: [{ id, qty }] }` |
| `POST` | `/api/products/:id/purchase` | Achat d'un seul produit `{ qty, customer? }` |
| `POST` | `/api/checkout` | Commande depuis le site (nom, téléphone, ville, adresse requis) |
| `PATCH` | `/api/products/:id/stock` | Modifier le stock `{ qty }` ou `{ decrement }` (clé `x-api-key` si `API_KEY` défini) |

Fichiers statiques servis : `/uploads`, `/qrcodes`, `/videos`, et les fichiers du site situés dans le dossier parent (`/` redirige vers `boutique.html`).

---

## 🗂️ Structure du projet

```
site/
├── boutique.html, produit.html, ...   # pages du site
└── bot/
    ├── index.js                       # bot + serveur Express
    ├── .env                           # secrets (non versionné)
    ├── products.json                  # base produits
    ├── orders.json                    # commandes
    ├── cooperatives.json              # coopératives autorisées
    ├── lang_memory.json               # langue mémorisée par numéro
    ├── uploads/  qrcodes/  videos/    # médias générés
    └── whatsapp_session/              # session WhatsApp (non versionnée)
```

---

## 🔐 Sécurité

- Ne jamais versionner `.env`, `whatsapp_session/`, `cooperatives.json` (numéros de téléphone) ni les données clients (`orders.json`).
- Définir `API_KEY` en production.
- Limitation du débit : 20 appels IA / minute / artisan, 5 commandes / minute / IP, 120 requêtes API / minute.
- Le serveur ne publie que les fichiers de site (extensions autorisées) : jamais le dossier du bot, `node_modules` ni les fichiers cachés.

---

## 📄 Licence

Projet académique / associatif. © Ahmed Elaajlaoui.
