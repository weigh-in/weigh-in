# Weigh-In

A free fishing app for you and your friends. It works on iPhone and Android. You open it in the phone's web browser and add it to your home screen, so it gets an icon like a normal app.

**What it does:** post catches with photos, swipe through everyone's catches like TikTok, comment on posts, run tournaments with leaderboards, keep a private fishing log, and add friends and chat with them.

**What it costs:** $0. GitHub Pages hosts the app for free. Firebase's free plan (called Spark) stores the accounts and posts, and it doesn't ask for a credit card.

**What you need:** a computer, about 20 minutes, a Google account (for Firebase), and a GitHub account. Both sites require you to be at least 13. If you're younger, ask a parent to set up the accounts with you.

---

## Step 1. Make a Firebase project

1. Go to **console.firebase.google.com** and sign in with your Google account.
2. Click **Create a project** (or **Add project**). Name it `weigh-in`. You can turn off Google Analytics. Click **Create project**.

## Step 2. Turn on sign-in

1. In the left menu, open **Build → Authentication** and click **Get started**.
2. On the **Sign-in method** tab, click **Email/Password**, switch on the first toggle, and click **Save**.
3. Open the **Settings** tab, then **Authorized domains**. Click **Add domain** and type `YOUR-GITHUB-NAME.github.io` (use your real GitHub username, all lowercase).

## Step 3. Turn on the database and add the safety rules

1. In the left menu, open **Build → Firestore Database** and click **Create database**.
2. Pick a location close to you (for example `us-central`) and choose **Start in production mode**. Click **Create**.
3. Open the **Rules** tab. Delete everything in the box, then open the `firestore.rules` file from this folder, copy all of it, and paste it in. Click **Publish**.

The rules are what keep the app safe. They make sure people can only post as themselves, only friends can read their chats, and only you can read your fishing log.

## Step 4. Connect the app to Firebase

1. Click the **gear icon** next to Project Overview, then **Project settings**.
2. Scroll to **Your apps** and click the **web icon** that looks like `</>`.
3. Name it `Weigh-In` and click **Register app**. Don't turn on Firebase Hosting.
4. Firebase shows some code with `const firebaseConfig = { ... }`. Copy just the part from `{` to `}`.
5. Open `firebase-config.js` from this folder in a text editor (Notepad on Windows, TextEdit on Mac). Replace everything between the `{` and `}` with what you copied, and save.

These values are not secret. Every Firebase web app has them in the page. Your data is protected by the rules from Step 3.

## Step 5. Put the app on GitHub Pages

1. Go to **github.com** and sign in (or make an account).
2. Click the **+** at the top right, then **New repository**. Name it `weigh-in`, set it to **Public**, and click **Create repository**.
3. On the next page, click **uploading an existing file**.
4. Drag in **everything** from this folder: all the files **and** the `icons` folder. Click **Commit changes**.
5. Open the repository's **Settings** tab, then **Pages** in the left menu. Under **Branch**, pick `main` and `/ (root)`, then click **Save**.
6. Wait a minute or two and refresh. GitHub shows your link. It looks like `https://YOUR-GITHUB-NAME.github.io/weigh-in/`.

## Step 6. Put it on your phone

Open your link on your phone, then:

- **iPhone:** in Safari, tap the **Share** button, then **Add to Home Screen**.
- **Android:** in Chrome, tap the **⋮** menu, then **Install app** or **Add to Home screen**.

Make an account, pick your angler name, and send the link to your friends.

---

## Changing the app later

To update a file, open it in your GitHub repository, click the **pencil** icon, paste the new version, and click **Commit changes**. The app updates in a minute or two.

## If something goes wrong

| What you see | What to do |
| --- | --- |
| "Almost there" screen | `firebase-config.js` still has `PASTE_YOURS_HERE`. Do Step 4 and upload the file again. |
| "Can't connect" screen | Check that Firestore is created and the rules are published (Step 3). |
| Sign-up fails on your github.io link | Add your `github.io` domain in Step 2, part 3. |
| "That isn't allowed" when posting | The rules didn't paste fully. Paste all of `firestore.rules` again and click **Publish**. |
| Page shows 404 | Wait a few minutes after Step 5. Check that `index.html` is in the top level of the repository, not inside another folder. |
| Old version still showing | Close the app fully and open it again. |

## Things to know

- **Anyone with your link can make an account.** They'll see the feed and tournaments, but not your chats or your log. Only share the link with people you know.
- **Don't post personal information** like your address, your school, or where you live in a photo's background.
- **Free limits:** Firebase's free plan allows about 50,000 reads and 20,000 writes a day, which is plenty for a group of friends. If you ever hit it, the app pauses until the next day. It never charges you unless you upgrade on purpose.
- **Photos** are shrunk on your phone before they upload, so posting is quick and saves space.
- **Lost password?** Tap **Forgot password** on the sign-in screen.
