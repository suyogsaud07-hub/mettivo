# METTIVO - Store Submission Checklist

**Date:** 2026-11-05  
**Auditor:** Principal Software Architect (AI-assisted)  
**Repository:** /Users/suyogsaud/dating-platform  
**Version:** 1.0  

---

## EXECUTIVE SUMMARY

**Current Status: PWA-ONLY (No Native Apps)**

This checklist is **primarily for future reference** when native mobile apps are developed. Currently, METTIVO is deployed as a **Progressive Web App (PWA)** which does not require app store submissions.

### Current Deployment Model
| Platform | Type | Distribution | Status |
|----------|------|--------------|--------|
| Website | Web App | Vercel | ✅ Production-ready |
| Android | PWA | Chrome/Firefox/Samsung | ✅ Production-ready |
| iOS | PWA | Safari | ✅ Production-ready |
| Windows | PWA | Chrome/Edge | ✅ Production-ready |
| Android Native | - | Google Play Store | ❌ Not implemented |
| iOS Native | - | Apple App Store | ❌ Not implemented |
| Windows Native | - | Microsoft Store | ❌ Not implemented |

### Store Submission Complexity
| Store | Complexity | Cost | Time to Approval |
|-------|------------|------|------------------|
| Google Play Store | Medium | $25 (one-time) | 1-3 days |
| Apple App Store | High | $99/year | 1-3 days |
| Microsoft Store | Low | $15 (one-time) | 1-3 days |

---

## 1. GOOGLE PLAY STORE CHECKLIST

### 1.1 Required Materials

#### Developer Account
- [ ] Google Play Developer account registered
- [ ] $25 registration fee paid
- [ ] Developer name chosen
- [ ] Contact information verified

#### App Information
- [ ] App title (50 characters max)
- [ ] App short description (80 characters max)
- [ ] App full description (4000 characters max)
- [ ] App category selected (Social or Dating)
- [ ] App tags (optional)
- [ ] App website URL
- [ ] App support email
- [ ] App support phone (optional)
- [ ] App support website

#### Graphics Assets
- [ ] App icon (512x512 PNG)
- [ ] Feature graphic (1024x500 PNG or JPEG)
- [ ] Screenshots (at least 2, max 8)
  - [ ] Phone: 1080x1920 (portrait)
  - [ ] Phone: 1080x1920 (landscape, optional)
  - [ ] Tablet: 1280x800 (portrait, optional)
  - [ ] Tablet: 1280x800 (landscape, optional)
- [ ] Promo video (optional, YouTube link)
- [ ] TV banner (optional)

#### App Content
- [ ] App Bundle (AAB) file generated
- [ ] Version code set
- [ ] Version name set
- [ ] Minimum Android version specified (API 21+ recommended)

### 1.2 App Content Rating

#### Questionnaire
- [ ] Content rating questionnaire completed
- [ ] Age restriction set (18+ for dating apps)
- [ ] Content descriptors selected
- [ ] Interactive elements declared

#### Required Documentation
- [ ] Privacy policy uploaded
- [ ] Privacy policy URL configured
- [ ] Content rating certification provided

### 1.3 App Functionality

#### Required Features
- [ ] App launches and runs
- [ ] All declared features work
- [ ] App handles errors gracefully
- [ ] App works on multiple screen sizes
- [ ] App works on multiple Android versions

#### Testing
- [ ] App tested on multiple devices
- [ ] App tested on multiple Android versions
- [ ] App tested in different orientations
- [ ] App tested with different network conditions

### 1.4 Privacy and Security

#### Data Collection
- [ ] Data collection disclosed in privacy policy
- [ ] Sensitive permissions justified
- [ ] Data usage purposes declared
- [ ] Data sharing practices disclosed

#### Security
- [ ] App uses HTTPS for all network traffic
- [ ] Sensitive data is encrypted
- [ ] App handles sensitive data securely
- [ ] App has no known security vulnerabilities

### 1.5 Age Restrictions

**Critical for Dating Apps:**

#### Age Gate
- [ ] Robust age verification implemented
- [ ] Users under 18 cannot register
- [ ] Users under 18 cannot access app
- [ ] Age verification cannot be bypassed

#### Content Rating
- [ ] App rated as 18+ (or equivalent)
- [ ] Age restriction enforced in app
- [ ] Age restriction enforced in store

#### Child Safety
- [ ] Child safety procedures documented
- [ ] Reporting system for underage users
- [ ] Content moderation for underage content
- [ ] Compliance with COPPA (if US users)
- [ ] Compliance with GDPR-K (if EU users)

### 1.6 Google Play Requirements for Dating Apps

#### Additional Requirements
- [ ] App complies with Google Play Dating App Policy
- [ ] App has clear safety features
- [ ] App has reporting system
- [ ] App has blocking system
- [ ] App has content moderation
- [ ] App has age verification

#### Policy Compliance
- [ ] No sexual content
- [ ] No explicit content
- [ ] No harassment or bullying
- [ ] No hate speech
- [ ] No illegal activities

### 1.7 Submission Process

#### Preparation
- [ ] All required materials prepared
- [ ] All testing completed
- [ ] All issues fixed
- [ ] App Bundle signed

#### Upload
- [ ] App Bundle uploaded
- [ ] Store listing created
- [ ] Graphics uploaded
- [ ] Content rating submitted

#### Review
- [ ] App submitted for review
- [ ] Review process monitored
- [ ] Review feedback addressed (if any)

#### Publication
- [ ] App approved for publication
- [ ] App published to production
- [ ] App store listing live

### 1.8 Post-Publication

#### Monitoring
- [ ] App performance monitored
- [ ] User reviews monitored
- [ ] Crash reports monitored
- [ ] App ratings tracked

#### Updates
- [ ] Update process established
- [ ] Version code incremented
- [ ] Release notes prepared
- [ ] Beta testing configured (optional)

---

## 2. APPLE APP STORE CHECKLIST

### 2.1 Required Materials

#### Developer Account
- [ ] Apple Developer account registered
- [ ] $99/year fee paid
- [ ] Developer certificate created
- [ ] Provisioning profiles created
- [ ] App ID registered

#### App Information
- [ ] App name (30 characters max)
- [ ] App subtitle (30 characters max, optional)
- [ ] App description (4000 characters max)
- [ ] App category selected (Social Networking or Lifestyle)
- [ ] App keywords (100 characters max, optional)
- [ ] App website URL
- [ ] App support URL
- [ ] App marketing URL (optional)
- [ ] App privacy policy URL

#### Graphics Assets
- [ ] App icon (1024x1024 PNG)
- [ ] Screenshots (at least 1, max 10)
  - [ ] iPhone: 6.5" display (1242x2688)
  - [ ] iPhone: 5.5" display (1242x2208)
  - [ ] iPhone: 4.7" display (750x1334)
  - [ ] iPhone Plus: 5.5" display (2048x2732)
  - [ ] iPad Pro: 12.9" display (2048x2732)
  - [ ] iPad: 9.7" display (1536x2048)
- [ ] App preview video (optional)
  - [ ] iPhone: 15-30 seconds
  - [ ] iPad: 15-30 seconds (optional)

#### App Content
- [ ] IPA file generated
- [ ] Version number set
- [ ] Build number set
- [ ] Minimum iOS version specified (iOS 12+ recommended)

### 2.2 App Store Connect Configuration

#### App Store Listing
- [ ] App created in App Store Connect
- [ ] App information configured
- [ ] Pricing configured
- [ ] Availability configured
- [ ] Localizations configured (optional)

#### In-App Purchases
- [ ] In-app purchases configured (if applicable)
- [ ] Subscription groups created (if applicable)
- [ ] Promotional images uploaded (optional)

### 2.3 App Content Rating

#### Questionnaire
- [ ] Content rating questionnaire completed
- [ ] Age restriction set (17+ or 18+ for dating apps)
- [ ] Content descriptors selected

#### Required Documentation
- [ ] Privacy policy uploaded
- [ ] Privacy policy URL configured
- [ ] Content rating certification provided

### 2.4 App Functionality

#### Required Features
- [ ] App launches and runs
- [ ] All declared features work
- [ ] App handles errors gracefully
- [ ] App works on iPhone
- [ ] App works on iPad
- [ ] App works on multiple iOS versions

#### Testing
- [ ] App tested on iPhone
- [ ] App tested on iPad
- [ ] App tested on iPod touch
- [ ] App tested on multiple iOS versions
- [ ] App tested in different orientations
- [ ] App tested with different network conditions

### 2.5 Privacy and Security

#### Data Collection
- [ ] Data collection disclosed in privacy policy
- [ ] Sensitive permissions justified
- [ ] Data usage purposes declared
- [ ] Data sharing practices disclosed

#### Privacy Manifest (iOS 17+)
- [ ] Privacy manifest created
- [ ] Data types declared
- [ ] Tracking purposes declared
- [ ] Data linked to identity declared
- [ ] Data used for tracking declared

#### Security
- [ ] App uses HTTPS for all network traffic
- [ ] Sensitive data is encrypted
- [ ] App handles sensitive data securely
- [ ] App has no known security vulnerabilities

### 2.6 Age Restrictions

**Critical for Dating Apps:**

#### Age Gate
- [ ] Robust age verification implemented
- [ ] Users under 17 cannot register (US) or 18 (other regions)
- [ ] Users under age cannot access app
- [ ] Age verification cannot be bypassed

#### Content Rating
- [ ] App rated as 17+ or 18+ (depending on region)
- [ ] Age restriction enforced in app
- [ ] Age restriction enforced in store

#### Child Safety
- [ ] Child safety procedures documented
- [ ] Reporting system for underage users
- [ ] Content moderation for underage content
- [ ] Compliance with COPPA (if US users)
- [ ] Compliance with GDPR-K (if EU users)

### 2.7 Apple App Store Requirements for Dating Apps

#### Additional Requirements
- [ ] App complies with Apple App Store Review Guidelines
- [ ] App has clear safety features
- [ ] App has reporting system
- [ ] App has blocking system
- [ ] App has content moderation
- [ ] App has age verification
- [ ] App has privacy policy

#### User-Generated Content
- [ ] App has content moderation
- [ ] App has reporting system
- [ ] App has blocking system
- [ ] App handles user-generated content safely

#### Policy Compliance
- [ ] No sexual content
- [ ] No explicit content
- [ ] No harassment or bullying
- [ ] No hate speech
- [ ] No illegal activities
- [ ] No gambling
- [ ] No real money trading

### 2.8 Submission Process

#### Preparation
- [ ] All required materials prepared
- [ ] All testing completed
- [ ] All issues fixed
- [ ] IPA signed and archived

#### Upload
- [ ] IPA uploaded via Xcode or Transporter
- [ ] App Store Connect listing configured
- [ ] Graphics uploaded
- [ ] Content rating submitted

#### Review
- [ ] App submitted for review
- [ ] Review process monitored
- [ ] Review feedback addressed (if any)

#### Publication
- [ ] App approved for publication
- [ ] App published to App Store
- [ ] App Store listing live

### 2.9 Post-Publication

#### Monitoring
- [ ] App performance monitored
- [ ] User reviews monitored
- [ ] Crash reports monitored
- [ ] App ratings tracked

#### Updates
- [ ] Update process established
- [ ] Version number incremented
- [ ] Build number incremented
- [ ] Release notes prepared
- [ ] TestFlight configured (optional)

---

## 3. MICROSOFT STORE CHECKLIST

### 3.1 Required Materials

#### Developer Account
- [ ] Microsoft Developer account registered
- [ ] $15 registration fee paid (one-time)
- [ ] Developer name chosen
- [ ] Contact information verified

#### App Information
- [ ] App name
- [ ] App description
- [ ] App category selected
- [ ] App age rating selected
- [ ] App website URL
- [ ] App support contact
- [ ] App privacy policy URL

#### Graphics Assets
- [ ] App icon (44x44, 62x62, 124x124, 256x256 PNG)
- [ ] Screenshots (at least 1, max 10)
- [ ] Promotional images (optional)

#### App Content
- [ ] App package (MSIX or APPX) generated
- [ ] Version number set
- [ ] Package identity name set
- [ ] Publisher display name set
- [ ] Package family name set

### 3.2 App Manifest

#### Required Fields
- [ ] Package identity
- [ ] Version
- [ ] Publisher
- [ ] Display name
- [ ] Description
- [ ] Minimum OS version
- [ ] Target OS version

### 3.3 App Functionality

#### Required Features
- [ ] App launches and runs
- [ ] All declared features work
- [ ] App handles errors gracefully
- [ ] App works on multiple screen sizes
- [ ] App works on multiple Windows versions

#### Testing
- [ ] App tested on Windows 10
- [ ] App tested on Windows 11
- [ ] App tested on different screen sizes
- [ ] App tested with different network conditions

### 3.4 Privacy and Security

#### Data Collection
- [ ] Data collection disclosed in privacy policy
- [ ] Sensitive permissions justified
- [ ] Data usage purposes declared

#### Security
- [ ] App uses HTTPS for all network traffic
- [ ] Sensitive data is encrypted
- [ ] App handles sensitive data securely

### 3.5 Submission Process

#### Preparation
- [ ] All required materials prepared
- [ ] All testing completed
- [ ] All issues fixed
- [ ] App package signed

#### Upload
- [ ] App package uploaded via Partner Center
- [ ] Store listing created
- [ ] Graphics uploaded

#### Review
- [ ] App submitted for review
- [ ] Review process monitored
- [ ] Review feedback addressed (if any)

#### Publication
- [ ] App approved for publication
- [ ] App published to Microsoft Store
- [ ] App Store listing live

---

## 4. PWA TO NATIVE CONVERSION

### 4.1 Capacitor Approach

**Recommended for converting PWA to native apps**

#### Steps
1. Install Capacitor
   ```bash
   npm install @capacitor/core @capacitor/cli
   npx cap init
   ```

2. Add Android
   ```bash
   npm install @capacitor/android
   npx cap add android
   ```

3. Add iOS
   ```bash
   npm install @capacitor/ios
   npx cap add ios
   ```

4. Configure App
   - Update `capacitor.config.ts`
   - Configure app ID
   - Configure app name
   - Configure web dir

5. Build Web App
   ```bash
   npm run build
   ```

6. Sync to Native Projects
   ```bash
   npx cap sync
   ```

7. Open in IDEs
   - Android: Open in Android Studio
   - iOS: Open in Xcode

8. Configure Native Features
   - Camera
   - Push notifications
   - Background modes
   - Deep linking

9. Build and Test
   - Android: Build APK/AAB
   - iOS: Build IPA
   - Test on devices

10. Submit to Stores

### 4.2 React Native Approach

**Recommended for new native development**

#### Steps
1. Create React Native project
   ```bash
   npx react-native init MettivoNative
   ```

2. Set up monorepo or shared code
   - Create shared library
   - Move shared code to library
   - Import library in React Native

3. Install Supabase
   ```bash
   npm install @supabase/supabase-js
   ```

4. Configure Supabase
   - Set up Supabase client
   - Configure auth
   - Configure realtime

5. Implement UI
   - Use React Native components
   - Style with Tailwind or custom
   - Implement navigation

6. Add Native Features
   - Camera
   - Push notifications
   - Background modes
   - Deep linking

7. Build and Test
   - Android: Build APK/AAB
   - iOS: Build IPA
   - Test on devices

8. Submit to Stores

### 4.3 PWA Builder Approach

**Recommended for Microsoft Store submission**

#### Steps
1. Use PWA Builder
   - https://www.pwabuilder.com/

2. Upload PWA
   - Upload manifest
   - Upload service worker
   - Upload assets

3. Generate Windows Package
   - Generate MSIX package
   - Configure package identity
   - Configure package version

4. Test Package
   - Install on Windows
   - Test functionality
   - Test offline support

5. Submit to Microsoft Store

---

## 5. CURRENT GAPS FOR NATIVE APPS

### 5.1 Technical Gaps

| Gap | Impact | Solution |
|-----|--------|----------|
| No native project | Cannot build native apps | Create React Native or Capacitor project |
| No app ID configured | Cannot submit to stores | Register app IDs |
| No signing configuration | Cannot sign apps | Create signing certificates |
| No provisioning profiles | Cannot build iOS | Create provisioning profiles |
| No push notification setup | Limited user engagement | Set up Firebase/APNs |
| No deep linking | Limited user engagement | Implement Universal Links/App Links |
| No camera access | Limited photo upload | Implement camera integration |
| No location access | Limited location features | Implement location services |

### 5.2 Content Gaps

| Gap | Impact | Solution |
|-----|--------|----------|
| No app store graphics | Cannot submit to stores | Create required graphics |
| No app descriptions | Cannot submit to stores | Write app descriptions |
| No screenshots | Cannot submit to stores | Create screenshots |
| No privacy policy | Cannot submit to stores | Create privacy policy |
| No support information | Cannot submit to stores | Set up support channels |

### 5.3 Policy Gaps

| Gap | Impact | Solution |
|-----|--------|----------|
| No age verification | App store rejection | Implement robust age verification |
| No content moderation | App store rejection | Implement moderation system |
| No reporting system | App store rejection | Implement reporting system |
| No blocking system | App store rejection | Implement blocking system |
| No safety features | App store rejection | Implement safety features |

---

## 6. RECOMMENDATIONS

### 6.1 Immediate Actions (For Future Native Apps)

1. **Document Native App Requirements**
   - Create native app architecture document
   - Define feature requirements
   - Define technical requirements
   - Define resource requirements

2. **Set Up Developer Accounts**
   - Google Play Developer account ($25)
   - Apple Developer account ($99/year)
   - Microsoft Developer account ($15)

3. **Register App IDs**
   - Android: com.mettivo.app
   - iOS: com.mettivo.app
   - Windows: Mettivo

4. **Create Signing Certificates**
   - Android: Keystore file
   - iOS: Development and distribution certificates
   - Windows: Signing certificate

### 6.2 Short-term Actions (If Native Apps Needed)

5. **Create PWA Builder Package**
   - Use PWA Builder for Microsoft Store
   - Generate Windows package
   - Test and submit

6. **Evaluate Capacitor**
   - Test Capacitor with existing PWA
   - Evaluate code sharing
   - Create conversion plan

7. **Implement Robust Age Verification**
   - Integrate age verification service
   - Test age gate
   - Document verification process

### 6.3 Long-term Actions (For Production Native Apps)

8. **Create React Native Project**
   - Set up React Native project
   - Configure shared code
   - Implement core features

9. **Implement Native Features**
   - Camera access
   - Push notifications
   - Deep linking
   - Background modes

10. **Submit to App Stores**
    - Prepare all required materials
    - Submit to Google Play Store
    - Submit to Apple App Store
    - Monitor review process

---

## 7. COST ANALYSIS

### 7.1 Developer Account Costs

| Store | Cost | Frequency |
|-------|------|-----------|
| Google Play Store | $25 | One-time |
| Apple App Store | $99 | Annual |
| Microsoft Store | $15 | One-time |
| **Total First Year** | **$139** | - |
| **Total Annual** | **$99** | - |

### 7.2 Development Costs

| Approach | Estimated Cost | Time |
|----------|----------------|------|
| Capacitor | $5,000 - $10,000 | 2-4 weeks |
| React Native | $10,000 - $20,000 | 4-8 weeks |
| Native (Android) | $15,000 - $30,000 | 6-12 weeks |
| Native (iOS) | $15,000 - $30,000 | 6-12 weeks |

### 7.3 Ongoing Costs

| Cost | Amount | Frequency |
|------|--------|-----------|
| Apple Developer Account | $99 | Annual |
| App Store Fees (if paid) | 15-30% | Per transaction |
| Hosting | $0 - $50 | Monthly |
| Monitoring | $0 - $100 | Monthly |
| **Total Annual** | **$99 - $1,299** | - |

---

## 8. TIMELINE

### 8.1 PWA Timeline (Current)
| Phase | Duration | Status |
|-------|----------|--------|
| Development | 0 days | ✅ Complete |
| Testing | 0 days | ✅ Complete |
| Deployment | 0 days | ✅ Complete |
| **Total** | **0 days** | **✅ Complete** |

### 8.2 Native Android Timeline
| Phase | Duration | Status |
|-------|----------|--------|
| Setup | 1-2 days | ❌ Not Started |
| Development | 10-15 days | ❌ Not Started |
| Testing | 5-10 days | ❌ Not Started |
| Submission | 1-3 days | ❌ Not Started |
| Review | 1-3 days | ❌ Not Started |
| **Total** | **18-33 days** | **❌ Not Started** |

### 8.3 Native iOS Timeline
| Phase | Duration | Status |
|-------|----------|--------|
| Setup | 1-2 days | ❌ Not Started |
| Development | 10-15 days | ❌ Not Started |
| Testing | 5-10 days | ❌ Not Started |
| Submission | 1-3 days | ❌ Not Started |
| Review | 1-3 days | ❌ Not Started |
| **Total** | **18-33 days** | **❌ Not Started** |

### 8.4 Microsoft Store Timeline (PWA Builder)
| Phase | Duration | Status |
|-------|----------|--------|
| Setup | 1 day | ❌ Not Started |
| Package Generation | 1-2 days | ❌ Not Started |
| Testing | 2-3 days | ❌ Not Started |
| Submission | 1-3 days | ❌ Not Started |
| Review | 1-3 days | ❌ Not Started |
| **Total** | **6-12 days** | **❌ Not Started** |

---

## APPENDIX A: STORE REQUIREMENTS REFERENCE

### Google Play Store Requirements
- https://play.google.com/console
- https://support.google.com/googleplay/android-developer

### Apple App Store Requirements
- https://developer.apple.com/app-store-connect
- https://developer.apple.com/app-store/review/guidelines

### Microsoft Store Requirements
- https://partner.microsoft.com/dashboard
- https://docs.microsoft.com/en-us/windows/uwp/publish/

### Dating App Policies
- Google Play: https://support.google.com/googleplay/android-developer/answer/10869029
- Apple App Store: https://developer.apple.com/app-store/review/guidelines/#dating

---

## APPENDIX B: USEFUL LINKS

### PWA Resources
- PWA Builder: https://www.pwabuilder.com/
- Web App Manifest: https://developer.mozilla.org/en-US/docs/Web/Manifest
- Service Workers: https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
- Lighthouse: https://developer.chrome.com/docs/lighthouse/overview/

### Native App Resources
- React Native: https://reactnative.dev/
- Capacitor: https://capacitorjs.com/
- Cordova: https://cordova.apache.org/

### Store Resources
- Google Play Console: https://play.google.com/console
- App Store Connect: https://appstoreconnect.apple.com/
- Microsoft Partner Center: https://partner.microsoft.com/dashboard

---

## APPENDIX C: TERMINOLOGY

- **PWA**: Progressive Web App
- **AAB**: Android App Bundle
- **APK**: Android Package Kit
- **IPA**: iOS App Archive
- **MSIX**: Microsoft Installer Package
- **APPX**: Windows App Package
- **Universal Links**: iOS deep links
- **App Links**: Android deep links
- **Firebase**: Google mobile development platform
- **APNs**: Apple Push Notification service
- **FCM**: Firebase Cloud Messaging
- **COPPA**: Children's Online Privacy Protection Act
- **GDPR**: General Data Protection Regulation
- **GDPR-K**: General Data Protection Regulation for Kids

---

**Document Version:** 1.0  
**Last Updated:** 2026-11-05  
**Next Review:** When native apps are considered
