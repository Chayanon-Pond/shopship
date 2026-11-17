import {
  Baby,
  BedDouble,
  Coffee,
  CupSoda,
  Droplet,
  Dumbbell,
  Footprints,
  Headphones,
  Mouse,
  PawPrint,
  Shirt,
  ShoppingBag,
  Sofa,
  Sparkles,
  Speaker,
  Sun,
  UtensilsCrossed,
  Watch,
  type LucideProps,
} from "lucide-react";

const map = {
  Baby,
  BedDouble,
  Coffee,
  CupSoda,
  Droplet,
  Dumbbell,
  Footprints,
  Headphones,
  Mouse,
  PawPrint,
  Shirt,
  ShoppingBag,
  Sofa,
  Sparkles,
  Speaker,
  Sun,
  UtensilsCrossed,
  Watch,
};

export function Icon({ name, ...props }: { name: string } & LucideProps) {
  const C = map[name as keyof typeof map] ?? ShoppingBag;
  return <C aria-hidden {...props} />;
}
