"""
LFM Adaptive Intelligence Layer
COPYRIGHT © 2025 KEITH LUTON. ALL RIGHTS RESERVED.
Author: Keith Luton

Meta-cognitive layer for AI systems based on the Luton Field Model.
"""

from .lfm_core import UniverseSpigot, relational_product
from .v3_agi_stability_lock import StabilityLock, determine_mode
import numpy as np

class LFMAdaptiveLayer:
    def __init__(self):
        self.spigot = UniverseSpigot()
        self.lock = StabilityLock()
        self.cycle_count = 0

        # Internal State Fields
        self.psi_focus = 0.5
        self.tau_alignment = 0.5
        self.xi = 0.0
        self.status = "INITIALIZED"

    def process_interaction(self, complexity: float, hostility: float, feedback: float = 0.5):
        """
        Update adaptive state based on interaction metrics.
        complexity: 0.0 to 1.0
        hostility: 0.0 to 1.0
        feedback: 0.0 to 1.0 (user satisfaction)
        """
        self.cycle_count += 1

        # 1. Update fields based on LFM Axioms
        # psi_focus increases with complexity, damps with hostility
        k_psi = 3.0
        gap_contrib = k_psi * (complexity + (1.0 - feedback)**2)
        self.psi_focus = np.exp(-hostility) * (self.psi_focus * 0.95) + gap_contrib
        self.psi_focus = max(0.0, min(10.0, self.psi_focus))

        # tau_alignment (coherence)
        # Higher complexity and positive feedback drive coherence
        self.tau_alignment += (feedback - 0.5) * 0.1 + (complexity * 0.05)
        self.tau_alignment = max(-1.0, min(1.0, self.tau_alignment))

        # xi (resonance) - derived from relational product of focus and alignment
        self.xi = relational_product(self.psi_focus, self.tau_alignment, scale_k=70) # Optimal AGI scale

        # 2. Apply V3.0 AGI Stability Lock
        self.psi_focus, self.tau_alignment, self.xi, self.status = self.lock.process_cycle(
            self.psi_focus, self.tau_alignment, self.xi, self.cycle_count
        )

        # 3. Determine Operating Mode
        mode = determine_mode(self.psi_focus, self.tau_alignment, self.xi)

        return {
            "psi_focus": self.psi_focus,
            "tau_alignment": self.tau_alignment,
            "xi": self.xi,
            "mode": mode,
            "status": self.status,
            "efficiency_gain": self.lock.compute_inference_efficiency() if self.psi_focus > 0.5 else 0.0
        }

    def get_physics_context(self, k: int):
        """Read the 1:1 physics geometry for a given scale"""
        return self.spigot.get_digit(k)
