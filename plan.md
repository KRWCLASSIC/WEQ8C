# Fork WEQ8 to WEQ8C on GitHub for Custom CSS Support

The current lifecycle monkey-patching (and `createRenderRoot` overrides) are unreliable because of how Lit elements manage their internal shadow DOM arrays and rendering cycles. 

To properly fix this, we will transition to using an official GitHub fork of `weq8` called `weq8c` which officially supports custom CSS injection.

## Proposed Changes

### 1. GitHub Fork (`weq8c`)
- **User Action**: You will fork the original `weq8` repository on GitHub to create your own `weq8c` repository.
- **Clone & Setup**: We will clone this new repository locally (e.g., `git clone https://github.com/KRWCLASSIC/WEQ8C.git`).

### 2. Add Official CSS Injection API to WEQ8C
- We will modify the source code of the `weq8c` repository to add a native CSS injection API. 
- We will expose a static `addCustomStyles(cssString)` method on the Lit components (`WEQ8UIElement` / `WEQ8UIFilterRow`). This method will use Lit's native styles array to safely inject CSS directly into the component's constructable stylesheets.
- This ensures the CSS is baked in seamlessly, completely avoiding lifecycle loops, resize observer bugs, or canvas layout breakage.

### 3. Build and Push the Fork
- We will build the `weq8c` project (`npm run build`).
- We will commit the changes and push them back up to your GitHub repository.

### 4. Update KEQ Extension
- In KEQ's `package.json`, we will update the dependency to point to your GitHub fork:
  `"weq8": "github:YOUR_USERNAME/weq8c"`
- In `src/inject.js`, we will remove all the hacky DOM-patching workarounds.
- We will use the new official API to pass the filter dropdown styling cleanly.

## Verification Plan
1. We will verify the KEQ extension successfully installs the dependency from GitHub.
2. You will build the KEQ extension (`npm run build`).
3. We will confirm the Equalizer renders perfectly with the custom dropdown styles applied, and the graph canvas remains stable.

> [!IMPORTANT]
> Please review this updated plan. Once you approve, let me know the URL of your new GitHub fork so we can clone it locally and start the modifications.
