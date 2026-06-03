import AddProductPage from './AddProduct';

// AddProductPage reads the :id route param itself (useParams) and switches to
// edit mode when it is present, so this wrapper just renders it.
const EditProductPage = () => <AddProductPage />;

export default EditProductPage;
