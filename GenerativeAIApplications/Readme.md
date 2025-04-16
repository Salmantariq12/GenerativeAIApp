# Voice Processor API - Setup Guide

## Overview
The Voice Processor API enables users to process audio files, convert speech to text using Google Cloud Speech-to-Text, and interact with Gemini AI. This guide provides step-by-step instructions for setting up and running the project.

---

## Prerequisites

Ensure you have the following installed:
- **.NET 8 SDK**
- **Visual Studio**
- **Google Cloud Console Account** ([Sign up here](https://console.cloud.google.com/))

---

## 1. Setting Up Google Cloud Speech-to-Text & Text-to-Speech

### 1.1 Create a Google Cloud Project
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click **Select a project** > **New Project**
3. Give it a name and click **Create**

### 1.2 Enable Required APIs
1. Navigate to **APIs & Services > Library**
2. Search for and enable the following APIs:
   - **Cloud Speech-to-Text API**
   - **Cloud Text-to-Speech API**
   - **Generative AI API** (for Gemini AI)

### 1.3 Set Up API Key Authentication

1. Go to **APIs & Services > Credentials** in the Google Cloud Console.
2. Click **Create Credentials** and select **API Key**.
3. Copy the generated API key and store it securely.
5. Replace the API key in appSettings.

6. Ensure you have added scopes by going to **API & Services > Credentials > OAuth 2.0 Client IDs/Data Access**  
7. **For service account authentication**:  
   - Go to **IAM & Admin > Service Accounts**  
   - Select or create a service account with the following roles:  
     - **Cloud Speech Administrator** (Required for Speech-to-Text API)  
     - **Owner** (Optional, for full project access)  
   - Click **Create Key**, select **JSON format**, and download the file.  
   - Move the JSON file to a secure location.  
   - Set the **ServiceAccountPath** in `appsettings.json`
---

## 2. Obtaining Your Gemini API Key

1. Go to [Google AI Studio](https://ai.google.dev/)
2. Sign in and navigate to **API Keys**
3. Generate a new API Key
4. Use this key in code where Gemini API Key is required

---

## 3. Permission Settings
Ensure your service account has the correct permissions:
- **Cloud Speech Administrator** (Required for Speech-to-Text API)
- **Owner** (Optional, for full project access)
To manage permissions, go to **IAM & Admin > IAM**

