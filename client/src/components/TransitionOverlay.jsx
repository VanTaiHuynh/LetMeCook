import { motion as Motion, AnimatePresence } from "framer-motion";

export default function TransitionOverlay({ isVisible }) {
  return (
    <AnimatePresence>
      {isVisible && (
        <Motion.div
          className="transition-overlay"
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "-100%" }}
          transition={{ duration: 0.8, ease: "easeInOut" }}
        />
      )}
    </AnimatePresence>
  );
}
