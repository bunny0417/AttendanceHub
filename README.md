# Attendance Hub 👋

A beautiful, responsive mobile application built with React Native and Expo to help students seamlessly track their college attendance, calculate bunking possibilities, and visualize their daily statistics.

## Project Setup

1. **Install dependencies:**

   ```bash
   npm install
   ```

2. **Start the development server:**

   ```bash
   npx expo start
   ```

## How to Compile to Android APK

This project uses [EAS (Expo Application Services)](https://expo.dev/eas) to compile the React Native application into a standalone Android APK.

Follow these steps to generate your APK:

### 1. Install the EAS CLI
First, you need to install the EAS command-line tool globally on your machine:

```bash
npm install -g eas-cli
```

### 2. Log in to your Expo Account
You need an Expo account to build the app. If you don't have one, create it at [expo.dev](https://expo.dev) and then log in via your terminal:

```bash
eas login
```

### 3. Configure the Project for EAS
Initialize EAS within the project (this only needs to be done once and creates an `eas.json` file if it doesn't already exist):

```bash
eas build:configure
```

### 4. Build the APK
To specifically tell EAS to build a `.apk` file instead of an `.aab` (Android App Bundle, which is used for the Google Play Store), run the following command:

```bash
eas build -p android --profile preview
```

*(Note: If you haven't set up a `preview` profile in `eas.json` that sets `buildType: "apk"`, EAS might build an `.aab` by default. Ensuring your `eas.json` specifies `"buildType": "apk"` under the preview profile guarantees an APK output).*

### 5. Download your APK
The EAS CLI will provide a link to the Expo dashboard where you can monitor the build progress. 

Once the build is complete, **a download link will be provided directly in your terminal**. You can click that link to download the `.apk` file and install it on your Android device!


![WhatsApp Image 2026-02-22 at 1 26 18 AM](https://github.com/user-attachments/assets/324d86bd-6237-4118-b511-a320bf10dd1d)

