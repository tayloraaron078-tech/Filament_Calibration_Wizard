# Contributing to PerfectFit Filament Calibration Wizard

Thanks for helping improve PerfectFit!

There are several ways you can contribute.

- Report bugs
- Suggest features
- Improve documentation
- Submit code improvements
- Test beta releases

Before creating a new Issue, please search existing issues to avoid duplicates.
# Contributing to PerfectFit Filament Calibration Wizard

Thank you for helping improve PerfectFit Filament Calibration Wizard.

PerfectFit is a guided desktop application that helps users calibrate filament for Orca Slicer and Bambu Studio. Contributions may include bug reports, feature suggestions, documentation improvements, testing, and code changes.

## Choosing the right contribution type

### Open a Bug Report when:

- The application crashes, freezes, or fails to open.
- A button, link, field, or navigation control does not work.
- Information is saved, calculated, or displayed incorrectly.
- Instructions do not match the selected slicer.
- Installation or updating fails.
- The same actions consistently produce incorrect application behavior.

An unexpected calibration print is not automatically an application bug. Printer condition, filament moisture, slicer configuration, and test interpretation may affect results.

### Open a Support or Calibration Question when:

- The application worked, but you are unsure which test result to select.
- You need help interpreting a calibration print.
- You do not know where to enter a value in Orca Slicer or Bambu Studio.
- You need clarification about the recommended calibration order.
- You are unsure whether something is normal.

### Open a Feature Request when:

- You have an idea for improving the calibration workflow.
- A missing capability would benefit multiple users.
- You want to propose support for another relevant calibration method.
- You have an accessibility or user-interface improvement.

Please describe the problem the feature would solve, not only the desired button or screen.

### Open a Documentation Correction when:

- An explanation is unclear.
- A procedure is incomplete.
- A slicer instruction is outdated or incorrect.
- Text contains a typo or misleading statement.
- Additional context would prevent user confusion.

### Open a Pull Request when:

- An issue has been discussed and the proposed approach is reasonably clear.
- You have a focused fix or improvement ready for review.
- You have tested the affected workflow.
- You are prepared to respond to review comments.

For substantial features or architectural changes, open an issue before writing the implementation. This avoids duplicated effort and helps ensure the proposal fits the project’s direction.

Small typo corrections and obvious documentation fixes may be submitted directly.

## Before opening an issue

1. Search open and closed issues for the same topic.
2. Confirm that you are using the latest available release.
3. Reproduce the problem when possible.
4. Collect screenshots, logs, version numbers, and exact steps.
5. Remove passwords, usernames, personal file paths, or other sensitive information.

## Development setup

PerfectFit uses Tauri with a web frontend and Rust backend.

### Requirements

- Node.js 20 or another version supported by the project
- npm
- Rust stable
- Tauri system prerequisites for your operating system

### Clone and run the project

```bash
git clone https://github.com/OWNER/REPOSITORY.git
cd REPOSITORY
npm install
npm run tauri dev
```

Replace `OWNER` and `REPOSITORY` with the correct GitHub repository information.

### Build the application

```bash
npm run tauri build
```

## Branches

Create a focused branch from the current default branch.

Suggested branch names:

```text
fix/short-description
feature/short-description
docs/short-description
chore/short-description
```

Examples:

```text
fix/bambu-flow-rate-navigation
feature/slicer-profile-installer
docs/macos-installation-warning
```

## Coding expectations

- Keep changes focused on one purpose.
- Follow the structure and style of the existing code.
- Prefer clear names over clever abbreviations.
- Do not introduce unrelated formatting changes.
- Add comments only where they clarify non-obvious behavior.
- Preserve compatibility with Orca Slicer and Bambu Studio unless the change is intentionally slicer-specific.
- Keep instructions accurate for the slicer and operating system being discussed.
- Do not add dependencies without explaining why they are necessary.
- Avoid committing build output, temporary files, credentials, secrets, or personal configuration.

## Testing expectations

At minimum:

1. Run the application locally.
2. Test the specific workflow you changed.
3. Verify that navigation still works.
4. Check for frontend, console, Rust, and build errors.
5. Test both slicer modes when shared behavior is affected.
6. Include screenshots for visible user-interface changes.

Installer, release, and platform-specific changes should be tested on the affected operating system whenever possible.

If you cannot test a relevant platform, clearly state that in the pull request.

## Pull requests

A good pull request should:

- Link to the related issue.
- Explain the problem and solution.
- Describe the testing performed.
- Include screenshots for visual changes.
- Avoid combining unrelated changes.
- Mention known limitations or areas that were not tested.
- Remain reasonably small and reviewable.

Submission does not guarantee that a pull request will be merged. Changes may be declined when they fall outside the project’s purpose, duplicate planned work, introduce excessive complexity, or cannot be maintained safely.

## Reviews

Feedback is part of the contribution process. Review comments may request:

- Code changes
- Additional testing
- Clearer documentation
- Reduced scope
- Compatibility fixes
- A different implementation approach

Please keep discussions focused, respectful, and constructive.

## Licensing

By submitting a contribution, you agree that your contribution may be distributed under the license used by this repository.

## Conduct

Be respectful and constructive when interacting with users and contributors. Personal attacks, harassment, threats, discrimination, and abusive behavior are not acceptable.
