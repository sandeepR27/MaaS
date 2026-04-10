import { auth } from "../lib/firebase/client";
import { sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink } from "firebase/auth";

export class AuthService {
  /**
   * Sends the magic link to the user's email for passwordless authentication.
   */
  public async sendMagicLink(email: string, redirectUrl: string): Promise<void> {
    const actionCodeSettings = {
      // Must exactly match an authorized domain in the Firebase Console
      url: redirectUrl,
      handleCodeInApp: true,
    };

    try {
      await sendSignInLinkToEmail(auth, email, actionCodeSettings);
      // Store the email in local storage to avoid asking the user 
      // if they open the link on the same device.
      if (typeof window !== "undefined") {
        window.localStorage.setItem("emailForSignIn", email);
      }
    } catch (error) {
      console.error("Error sending magic link", error);
      throw error;
    }
  }

  /**
   * Completes the login process when the user clicks the magic link.
   */
  public async confirmMagicLink(url: string = window.location.href): Promise<void> {
    if (!isSignInWithEmailLink(auth, url)) {
      throw new Error("Invalid or expired magic link.");
    }

    let email = window.localStorage.getItem("emailForSignIn");
    if (!email) {
      // Prompt user for email if they open the link on a different device
      email = window.prompt("Please provide your email for confirmation");
      if (!email) throw new Error("Email is required to confirm sign-in");
    }

    try {
      const result = await signInWithEmailLink(auth, email, url);
      window.localStorage.removeItem("emailForSignIn");
      // Handle the resulting UserCredential
    } catch (error) {
      console.error("Error confirming magic link", error);
      throw error;
    }
  }
}
