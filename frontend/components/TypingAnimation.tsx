"use client";

import { useEffect, useState } from "react";

const messages = [
  "What am I paying",
  "Book me a dentist",
  "Send Mark the notes from the",
  "I need your help. That return",
  "Plan Maya's birthday, she turns",
];

export default function TypingAnimation() {
  const [currentMessageIndex, setCurrentMessageIndex] = useState(0);
  const [currentText, setCurrentText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [showCursor, setShowCursor] = useState(true);

  useEffect(() => {
    const currentMessage = messages[currentMessageIndex];
    const typingSpeed = isDeleting ? 30 : 80;
    const pauseBeforeDelete = 2000;
    const pauseBeforeNext = 500;

    const timeout = setTimeout(
      () => {
        if (!isDeleting) {
          // Typing
          if (currentText.length < currentMessage.length) {
            setCurrentText(currentMessage.slice(0, currentText.length + 1));
          } else {
            // Finished typing, pause then start deleting
            setTimeout(() => setIsDeleting(true), pauseBeforeDelete);
          }
        } else {
          // Deleting
          if (currentText.length > 0) {
            setCurrentText(currentText.slice(0, -1));
          } else {
            // Finished deleting, move to next message
            setIsDeleting(false);
            setCurrentMessageIndex((prev) => (prev + 1) % messages.length);
            setTimeout(() => {}, pauseBeforeNext);
          }
        }
      },
      isDeleting ? typingSpeed : typingSpeed
    );

    return () => clearTimeout(timeout);
  }, [currentText, isDeleting, currentMessageIndex]);

  // Cursor blink effect
  useEffect(() => {
    const cursorInterval = setInterval(() => {
      setShowCursor((prev) => !prev);
    }, 530);

    return () => clearInterval(cursorInterval);
  }, []);

  return (
    <span className="inline-flex items-center">
      {currentText}
      <span
        className={`inline-block w-[2px] h-[1.1em] bg-[#007AFF] ml-[2px] transition-opacity ${
          showCursor ? "opacity-100" : "opacity-0"
        }`}
        style={{ verticalAlign: "middle" }}
      />
    </span>
  );
}
