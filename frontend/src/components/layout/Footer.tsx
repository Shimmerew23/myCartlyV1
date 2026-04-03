import { Link } from 'react-router-dom';

const Footer = () => (
  <footer className="bg-on-surface text-white mt-20">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10">
        <div className="lg:col-span-1">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 editorial-gradient rounded-sm flex items-center justify-center">
              <span className="text-white font-headline font-black text-sm">TC</span>
            </div>
            <span className="font-headline font-extrabold text-lg tracking-tighter uppercase">CartLy</span>
          </div>
          <p className="text-white/50 text-sm leading-relaxed">
            A premium marketplace connecting collectors with exceptional products worldwide.
          </p>
        </div>

        {[
          { title: 'Shop', links: [['New Arrivals', '/products?newArrival=true'], ['Trending', '/products?trending=true'], ['All Products', '/products'], ['Sellers', '/sellers']] },
          { title: 'Account', links: [['Sign In', '/login'], ['Register', '/register'], ['My Orders', '/orders'], ['Wishlist', '/wishlist'], ['Become a Seller', '/become-seller']] },
          { title: 'Company', links: [['About', '#'], ['Careers', '#'], ['Press', '#'], ['Privacy Policy', '#'], ['Terms of Service', '#']] },
        ].map((col) => (
          <div key={col.title}>
            <h4 className="label-sm text-white/80 mb-4">{col.title}</h4>
            <ul className="space-y-2.5">
              {col.links.map(([label, to]) => (
                <li key={label}>
                  <Link to={to} className="text-white/50 text-sm hover:text-white transition-colors">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="mt-12 pt-8 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-4">
        <p className="text-white/30 text-xs">
          © {new Date().getFullYear()} CartLy. All rights reserved.
        </p>
        <div className="flex items-center gap-4">
          {['Visa', 'Mastercard', 'Stripe', 'PayPal'].map((p) => (
            <span key={p} className="text-white/30 text-xs border border-white/10 rounded px-2 py-1">{p}</span>
          ))}
        </div>
      </div>
    </div>
  </footer>
);

export default Footer;
