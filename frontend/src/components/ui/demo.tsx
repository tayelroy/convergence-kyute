import { GradientButton } from "@/components/ui/gradient-button"

function Demo() {
    return (
        <div className="flex gap-8">
            <GradientButton>Get Started</GradientButton>
            <GradientButton variant="variant">Get Started</GradientButton>
        </div>
    )
}

export { Demo }
