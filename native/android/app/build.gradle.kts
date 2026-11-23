plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.fleresjourney.intervaltimer"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.fleresjourney.intervaltimer"
        minSdk = 26
        targetSdk = 36
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        versionCode = 1
        versionName = "0.1.0"
    }

    flavorDimensions += "device"
    productFlavors {
        create("phone") { dimension = "device" }
        create("wear") { dimension = "device" }
    }

    sourceSets["main"].assets.srcDirs("../../../web/voice", "../../audio")
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    jvmToolchain(21)
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test:core:1.6.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
}
