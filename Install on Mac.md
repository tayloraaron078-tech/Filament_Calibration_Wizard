# Install on Mac

This guide is for people who just want to install the released **PerfectFit** Mac app from GitHub. You do **not** need Node.js, Rust, Tauri, Xcode, Terminal, or any developer tools.

## Before you start

- Use the Mac download, not the Windows `.exe`, Linux `.deb`, or Linux `.AppImage` files.
- The Mac release is a universal `.dmg`, which means the same download works on both Apple Silicon Macs (M1/M2/M3/M4) and Intel Macs.
- Only download PerfectFit from the official repository releases page:
  <https://github.com/tayloraaron078-tech/Filament_Calibration_Wizard/releases>

## Step-by-step install

1. Open the releases page:
   <https://github.com/tayloraaron078-tech/Filament_Calibration_Wizard/releases>
2. Click the newest release at the top of the page.
3. Find the **Assets** section for that release.
   - If the assets are hidden, click **Assets** to expand them.
4. Download the file that ends in **`.dmg`**.
   - Do not download the source code `.zip` or `.tar.gz` files unless you are a developer.
5. When the download finishes, open your **Downloads** folder.
6. Double-click the downloaded **`.dmg`** file.
7. A small installer window should open.
8. Drag **PerfectFit** into the **Applications** folder shown in that window.
9. Wait for the copy to finish.
10. Close the installer window.
11. In Finder, eject the PerfectFit disk image:
    - Look in the Finder sidebar for the mounted PerfectFit disk.
    - Click the eject icon next to it.
12. Open your **Applications** folder.
13. Double-click **PerfectFit** to launch it.

## If macOS says it cannot verify the app

Depending on how the release was built, macOS Gatekeeper may show a warning such as:

- "Apple could not verify PerfectFit is free of malware"
- "PerfectFit cannot be opened because the developer cannot be verified"

If you downloaded the `.dmg` from the official releases page and you trust it, do this:

1. Open **Applications** in Finder.
2. Find **PerfectFit**.
3. Hold **Control** on your keyboard and click **PerfectFit**.
   - You can also right-click it if your mouse or trackpad is set up for right-click.
4. Click **Open**.
5. If macOS asks again, click **Open** one more time.

After you approve it once, you should be able to open PerfectFit normally in the future.

## If macOS still blocks it

If Control-click → **Open** does not work:

1. Open **System Settings**.
2. Go to **Privacy & Security**.
3. Scroll down to the **Security** section.
4. Look for a message about **PerfectFit** being blocked.
5. Click **Open Anyway**.
6. Enter your Mac password or use Touch ID if asked.
7. Try opening **PerfectFit** again from the **Applications** folder.

## After installing

- You can delete the downloaded `.dmg` file from your **Downloads** folder after PerfectFit is copied to **Applications**.
- Always open PerfectFit from **Applications**, Launchpad, or Spotlight after installing.
- Your PerfectFit data is stored locally on your Mac. Before replacing or removing the app, use **Settings → Export all data** inside PerfectFit if you want a backup of your projects.

## Updating PerfectFit later

To update to a newer release:

1. Download the newest Mac `.dmg` from the releases page.
2. Open the `.dmg`.
3. Drag the new **PerfectFit** app into **Applications**.
4. If macOS asks whether to replace the existing app, click **Replace**.
5. Open PerfectFit from **Applications**.

Your projects should remain on your Mac, but exporting a backup first is still a good habit.

## Quick troubleshooting

### I downloaded a `.zip` instead of a `.dmg`

You probably downloaded the source code. Go back to the release, open **Assets**, and download the file ending in **`.dmg`**.

### The app opens from the `.dmg`, but disappears later

You may have run it from the disk image instead of installing it. Open the `.dmg` again and drag **PerfectFit** into **Applications**.

### I cannot find the app after installing

Open Finder, click **Applications**, and look for **PerfectFit**. You can also press **Command + Space**, type `PerfectFit`, and press **Return**.

### The `.dmg` will not open or says it is damaged

Delete the downloaded `.dmg`, download it again from the official releases page, and try again. If it still fails, report the exact release version and the exact macOS warning message in GitHub Issues.
